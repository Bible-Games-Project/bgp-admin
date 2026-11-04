// Ruben, the console's assistant: the chat the page shows on every page (components/
// assistant/). One open conversation per person, kept in the Build chat's tables as chats
// of kind 'assistant'; the build server runs the messages like the Build chat's, with the
// console's tools instead of a repository (assistant.server.ts). See src/lib/assistant.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  TURN_COLUMNS,
  aheadOf,
  assertAdmin,
  readRunner,
  readSettings,
  requestUsageRefresh,
  turnView,
  type BuildTurn,
} from "@/lib/agent.functions";
import { keepRunnerWatching, weeklyBudgetNow } from "@/lib/agent.server";
import { MAX_PROMPT_CHARS, budgetExhaustedMessage, isActiveTurn } from "@/lib/agent";
import { cleanContext, type PageContext } from "@/lib/assistant";

const admin = () => supabaseAdmin as any;
const nowIso = () => new Date().toISOString();
const TURNS_SHOWN = 30;

async function openChat(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("agent_chats")
    .select("id, created_at")
    .eq("kind", "assistant")
    .eq("user_id", userId)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { id: string; created_at: string } | null;
}

export type AssistantTurn = BuildTurn & { context: PageContext | null };

/** The person's conversation with Ruben, polled while the chat is open. */
export const getAssistantChat = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    await keepRunnerWatching();
    const [chat, runner, settings, { data: pending }] = await Promise.all([
      openChat(supabase, userId),
      readRunner(supabase),
      readSettings(supabase),
      supabase
        .from("agent_turns")
        .select("id, app_id, status, created_at, apps(name)")
        .in("status", ["queued", "running"])
        .order("created_at", { ascending: true })
        .limit(20),
    ]);
    let turns: AssistantTurn[] = [];
    if (chat) {
      const { data: rows, error } = await supabase
        .from("agent_turns")
        .select(`${TURN_COLUMNS}, context`)
        .eq("chat_id", chat.id)
        .order("created_at", { ascending: false })
        .order("id", { referencedTable: "agent_events", ascending: true })
        .limit(TURNS_SHOWN);
      if (error) throw new Error(error.message);
      turns = (rows ?? [])
        .reverse()
        .map((t: any) => ({ ...turnView(t), context: t.context ? cleanContext(t.context) : null }));
    }
    const active = turns.find((t) => isActiveTurn(t.status));
    const [budget] = await Promise.all([
      weeklyBudgetNow(settings.weeklyBudgetPercent, runner.usage),
      requestUsageRefresh(runner),
    ]);
    return {
      chatId: chat?.id ?? null,
      turns,
      waitingFor: active?.status === "queued" ? aheadOf(active, pending ?? [], null) : null,
      settings,
      budget,
      ...runner,
    };
  });

/** A message to Ruben, with where the person is. It waits in the build server's queue. */
export const sendAssistantMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        prompt: z
          .string()
          .trim()
          .min(1, "Write something first.")
          .max(
            MAX_PROMPT_CHARS,
            `Keep it under ${MAX_PROMPT_CHARS.toLocaleString("en")} characters.`,
          ),
        context: z.unknown().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const [{ account, usage }, settings] = await Promise.all([
      readRunner(supabase),
      readSettings(supabase),
    ]);
    if (!account)
      throw new Error("No Claude account is linked yet. Link one in Settings → Claude.");
    if (account.rejectedAt)
      throw new Error(
        "Claude no longer accepts the linked account. Link it again in Settings → Claude.",
      );
    const budget = await weeklyBudgetNow(settings.weeklyBudgetPercent, usage);
    if (budget.exhausted) throw new Error(budgetExhaustedMessage(budget));

    let chat = await openChat(supabase, userId);
    if (!chat) {
      const created = await admin()
        .from("agent_chats")
        .insert({ kind: "assistant", user_id: userId, created_by: userId })
        .select("id, created_at")
        .single();
      // Two tabs starting the chat at once: the other one won.
      chat = created.data ?? (await openChat(admin(), userId));
      if (!chat) throw new Error(created.error?.message ?? "Couldn't start the chat.");
    }
    const { data: busy } = await admin()
      .from("agent_turns")
      .select("id")
      .eq("chat_id", chat.id)
      .in("status", ["queued", "running"])
      .limit(1);
    if (busy?.length)
      throw new Error("Ruben is still on your last message. Wait for it, or press Stop.");

    // The page may not know the app's name; the message tells Claude.
    const pageContext = cleanContext(data.context);
    if (pageContext.appId && !pageContext.appName) {
      const { data: app } = await supabase
        .from("apps")
        .select("name")
        .eq("id", pageContext.appId)
        .maybeSingle();
      if (app?.name) pageContext.appName = app.name;
    }
    const { data: turn, error } = await admin()
      .from("agent_turns")
      .insert({
        chat_id: chat.id,
        app_id: null,
        prompt: data.prompt,
        context: pageContext,
        created_by: userId,
        created_by_email: (context.claims.email as string | undefined) ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await keepRunnerWatching();
    return { turnId: turn.id as string, chatId: chat.id };
  });

/** Closes the person's chat: the next message starts a new conversation. */
export const newAssistantChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const chat = await openChat(supabase, userId);
    if (!chat) return { ok: true };
    const { data: busy } = await admin()
      .from("agent_turns")
      .select("id")
      .eq("chat_id", chat.id)
      .in("status", ["queued", "running"])
      .limit(1);
    if (busy?.length) throw new Error("Ruben is still working. Wait for it, or press Stop first.");
    await admin().from("agent_chats").update({ archived_at: nowIso() }).eq("id", chat.id);
    return { ok: true };
  });
