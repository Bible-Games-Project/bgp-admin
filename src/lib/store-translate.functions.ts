// "Translate with Claude" on the Store tab (see store-translate.ts): the page asks for a
// translation, the build server runs it as a short turn in the person's 'translate' chat,
// and the page polls until the translated fields come back. Nothing is saved to a store.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { aheadOf, assertAdmin, readRunner, readSettings } from "@/lib/agent.functions";
import { keepRunnerWatching, weeklyBudgetNow } from "@/lib/agent.server";
import { budgetExhaustedMessage } from "@/lib/agent";
import { ASC_LIMITS, PLAY_LIMITS } from "@/lib/store-listing";
import {
  TRANSLATED_FIELDS,
  fieldsToTranslate,
  parseTranslation,
  translationPrompt,
  type TranslateStore,
} from "@/lib/store-translate";

const admin = () => supabaseAdmin as any;

export const limitsFor = (store: TranslateStore): Record<string, number> =>
  store === "ios" ? ASC_LIMITS : PLAY_LIMITS;

async function translateChat(userId: string) {
  const find = () =>
    admin()
      .from("agent_chats")
      .select("id")
      .eq("kind", "translate")
      .eq("user_id", userId)
      .is("archived_at", null)
      .maybeSingle();
  const { data: open } = await find();
  if (open) return open.id as string;
  const created = await admin()
    .from("agent_chats")
    .insert({ kind: "translate", user_id: userId, created_by: userId })
    .select("id")
    .single();
  // Two tabs starting it at once: the other one won.
  const id = created.data?.id ?? (await find()).data?.id;
  if (!id) throw new Error(created.error?.message ?? "Couldn't start the translation.");
  return id as string;
}

/** Queues a translation of one language's texts from another. Returns the turn to poll. */
export const startStoreTranslation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        appId: z.string().uuid(),
        store: z.enum(["ios", "play"]),
        from: z.string().min(2).max(20),
        to: z.string().min(2).max(20),
        fields: z.record(z.string(), z.string().max(5000)),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    if (data.from === data.to) throw new Error("Pick a language other than the primary one.");
    const fields = fieldsToTranslate(data.store, data.fields);
    if (!Object.keys(fields).length)
      throw new Error("The primary language has no text to translate yet.");

    const [{ account, usage, runner }, settings, { data: app }] = await Promise.all([
      readRunner(supabase),
      readSettings(supabase),
      supabase.from("apps").select("name").eq("id", data.appId).maybeSingle(),
    ]);
    if (!app) throw new Error("This app isn't in the console any more.");
    if (!account)
      throw new Error(
        "Claude isn't linked to the console yet, so it can't translate. Link it in Settings → Claude.",
      );
    if (account.rejectedAt)
      throw new Error(
        "Claude no longer accepts the linked account. Link it again in Settings → Claude.",
      );
    if (!runner.online)
      throw new Error(
        "The build server Claude runs on is offline right now, so it can't translate. Try again later, or translate the texts by hand.",
      );
    const budget = await weeklyBudgetNow(settings.weeklyBudgetPercent, usage);
    if (budget.exhausted) throw new Error(budgetExhaustedMessage(budget));

    const chatId = await translateChat(userId);
    const prompt = translationPrompt({
      store: data.store,
      appName: app.name,
      from: data.from,
      to: data.to,
      fields,
      limits: limitsFor(data.store),
    });
    const { data: turn, error } = await admin()
      .from("agent_turns")
      .insert({
        chat_id: chatId,
        app_id: null,
        prompt,
        context: {
          purpose: "translate",
          appId: data.appId,
          appName: app.name,
          store: data.store,
          from: data.from,
          to: data.to,
          fields: Object.keys(fields),
        },
        created_by: userId,
        created_by_email: (context.claims.email as string | undefined) ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await keepRunnerWatching();
    return { turnId: turn.id as string };
  });

export type StoreTranslationState =
  | { id: string; state: "waiting"; waitingFor: string | null }
  | { id: string; state: "running" }
  | { id: string; state: "done"; fields: Record<string, string>; overLimit: string[] }
  | { id: string; state: "failed"; error: string };

/** How the person's translations are going; finished ones carry the translated fields. */
export const getStoreTranslations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ turnIds: z.array(z.string().uuid()).min(1).max(20) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<StoreTranslationState[]> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    await keepRunnerWatching();
    const [{ data: rows, error }, { data: pending }] = await Promise.all([
      supabase
        .from("agent_turns")
        .select("id, status, reply, error, created_at, context, agent_chats!inner(kind)")
        .in("id", data.turnIds)
        .eq("agent_chats.kind", "translate"),
      supabase
        .from("agent_turns")
        .select("id, app_id, status, created_at, context, apps(name)")
        .in("status", ["queued", "running"])
        .order("created_at", { ascending: true })
        .limit(20),
    ]);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((t: any): StoreTranslationState => {
      if (t.status === "queued")
        return {
          id: t.id,
          state: "waiting",
          waitingFor: aheadOf({ id: t.id, createdAt: t.created_at }, pending ?? [], null),
        };
      if (t.status === "running") return { id: t.id, state: "running" };
      if (t.status !== "done")
        return {
          id: t.id,
          state: "failed",
          error: t.status === "cancelled" ? "Stopped." : (t.error ?? "Something went wrong."),
        };
      const store: TranslateStore = t.context?.store === "play" ? "play" : "ios";
      const requested: string[] = Array.isArray(t.context?.fields)
        ? t.context.fields
        : [...TRANSLATED_FIELDS[store]];
      const parsed = parseTranslation(t.reply, requested, limitsFor(store));
      return parsed.ok
        ? { id: t.id, state: "done", fields: parsed.fields, overLimit: parsed.overLimit }
        : { id: t.id, state: "failed", error: parsed.error };
    });
  });
