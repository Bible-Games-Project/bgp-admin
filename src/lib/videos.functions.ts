// The Videos page's conversations with Claude, one open per game (src/lib/videos.ts). Kept in
// the Build chat's tables as chats of kind 'video'; the build server runs the messages like
// Ruben's (agent.server.ts, claimTurn).
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
} from "@/lib/agent.functions";
import { keepRunnerWatching, weeklyBudgetNow } from "@/lib/agent.server";
import { MAX_PROMPT_CHARS, budgetExhaustedMessage, isActiveTurn } from "@/lib/agent";
import { cleanContext } from "@/lib/assistant";
import type { AssistantTurn } from "@/lib/assistant.functions";
import { videoContext } from "@/lib/videos";

const admin = () => supabaseAdmin as any;
const nowIso = () => new Date().toISOString();
const TURNS_SHOWN = 30;
const appInput = z.object({ appId: z.string().uuid() });

async function openChat(supabase: any, appId: string) {
  const { data, error } = await supabase
    .from("agent_chats")
    .select("id, created_at")
    .eq("kind", "video")
    .eq("app_id", appId)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { id: string; created_at: string } | null;
}

async function busyIn(chatId: string) {
  const { data } = await admin()
    .from("agent_turns")
    .select("id")
    .eq("chat_id", chatId)
    .in("status", ["queued", "running"])
    .limit(1);
  return Boolean(data?.length);
}

/** A game's Videos conversation, polled while the page is open. */
export const getVideoChat = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => appInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    await keepRunnerWatching();
    const [chat, runner, settings, { data: pending }] = await Promise.all([
      openChat(supabase, data.appId),
      readRunner(supabase),
      readSettings(supabase),
      supabase
        .from("agent_turns")
        .select("id, app_id, status, created_at, context, apps(name)")
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

/** A message in a game's Videos conversation. It waits in the build server's queue. */
export const sendVideoMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    appInput
      .extend({
        prompt: z
          .string()
          .trim()
          .min(1, "Write something first.")
          .max(
            MAX_PROMPT_CHARS,
            `Keep it under ${MAX_PROMPT_CHARS.toLocaleString("en")} characters.`,
          ),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const [{ account, usage }, settings, { data: app }] = await Promise.all([
      readRunner(supabase),
      readSettings(supabase),
      supabase.from("apps").select("id, name").eq("id", data.appId).maybeSingle(),
    ]);
    if (!app) throw new Error("This game isn't in the console any more.");
    if (!account)
      throw new Error("No Claude account is linked yet. Link one in Settings → Claude.");
    if (account.rejectedAt)
      throw new Error(
        "Claude no longer accepts the linked account. Link it again in Settings → Claude.",
      );
    const budget = await weeklyBudgetNow(settings.weeklyBudgetPercent, usage);
    if (budget.exhausted) throw new Error(budgetExhaustedMessage(budget));

    let chat = await openChat(supabase, app.id);
    if (!chat) {
      const created = await admin()
        .from("agent_chats")
        .insert({ kind: "video", app_id: app.id, created_by: userId })
        .select("id, created_at")
        .single();
      // Two tabs starting the chat at once: the other one won.
      chat = created.data ?? (await openChat(admin(), app.id));
      if (!chat) throw new Error(created.error?.message ?? "Couldn't start the chat.");
    }
    if (await busyIn(chat.id))
      throw new Error("Claude is still on the last message. Wait for it, or press Stop.");

    const { data: turn, error } = await admin()
      .from("agent_turns")
      .insert({
        chat_id: chat.id,
        app_id: null,
        prompt: data.prompt,
        context: videoContext(app.id, app.name),
        created_by: userId,
        created_by_email: (context.claims.email as string | undefined) ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await keepRunnerWatching();
    return { turnId: turn.id as string, chatId: chat.id };
  });

/** Closes a game's Videos conversation: the next message starts a new one. */
export const newVideoChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => appInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const chat = await openChat(supabase, data.appId);
    if (!chat) return { ok: true };
    if (await busyIn(chat.id))
      throw new Error("Claude is still working. Wait for it, or press Stop first.");
    await admin().from("agent_chats").update({ archived_at: nowIso() }).eq("id", chat.id);
    return { ok: true };
  });
