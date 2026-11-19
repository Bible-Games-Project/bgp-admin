// "Make screenshots with Claude" on the Store tab (see store-screenshots.ts): the page asks
// for a design, the build server runs it as a short turn in the person's 'translate' chat
// (the Store tab's jobs), and the page polls until the design comes back. The images are
// made in the browser, and nothing reaches a store until the person adds them.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { aheadOf, assertAdmin, readRunner, readSettings } from "@/lib/agent.functions";
import { keepRunnerWatching, weeklyBudgetNow } from "@/lib/agent.server";
import { budgetExhaustedMessage } from "@/lib/agent";
import { translateChat } from "@/lib/store-translate.functions";
import {
  CAPTION_MAX,
  MAX_CAPTURES,
  SCREENSHOT_DECOR,
  SCREENSHOT_FONTS,
  SCREENSHOT_FRAMES,
  parseScreenshotDesign,
  screenshotsPrompt,
  type ScreenshotDesign,
} from "@/lib/store-screenshots";

const admin = () => supabaseAdmin as any;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const designSchema = z.object({
  background: z.tuple([hex, hex]),
  textColor: hex,
  accentColor: hex,
  font: z.enum(SCREENSHOT_FONTS),
  captionPosition: z.enum(["top", "bottom"]),
  frame: z.enum(SCREENSHOT_FRAMES),
  decor: z.enum(SCREENSHOT_DECOR),
  captions: z.array(z.string().max(CAPTION_MAX * 2)).max(MAX_CAPTURES),
});

/** Queues a screenshot design for one language. Returns the turn to poll. */
export const startScreenshotDesign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        appId: z.string().uuid(),
        store: z.enum(["ios", "play"]),
        locale: z.string().min(2).max(20),
        style: z.string().max(2000),
        notes: z.array(z.string().max(300)).min(1).max(MAX_CAPTURES),
        about: z.string().max(5000),
        previous: designSchema.nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const [{ account, usage, runner }, settings, { data: app }] = await Promise.all([
      readRunner(supabase),
      readSettings(supabase),
      supabase.from("apps").select("name").eq("id", data.appId).maybeSingle(),
    ]);
    if (!app) throw new Error("This app isn't in the console any more.");
    if (!account)
      throw new Error(
        "Claude isn't linked to the console yet, so it can't design screenshots. Link it in Settings → Claude.",
      );
    if (account.rejectedAt)
      throw new Error(
        "Claude no longer accepts the linked account. Link it again in Settings → Claude.",
      );
    if (!runner.online)
      throw new Error("The build server Claude runs on is offline right now. Try again later.");
    const budget = await weeklyBudgetNow(settings.weeklyBudgetPercent, usage);
    if (budget.exhausted) throw new Error(budgetExhaustedMessage(budget));

    const chatId = await translateChat(userId);
    const prompt = screenshotsPrompt({
      store: data.store,
      appName: app.name,
      locale: data.locale,
      style: data.style,
      notes: data.notes,
      about: data.about,
      previous: (data.previous as ScreenshotDesign | null | undefined) ?? null,
    });
    const { data: turn, error } = await admin()
      .from("agent_turns")
      .insert({
        chat_id: chatId,
        app_id: null,
        prompt,
        context: {
          purpose: "screenshots",
          appId: data.appId,
          appName: app.name,
          store: data.store,
          locale: data.locale,
          count: data.notes.length,
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

export type ScreenshotDesignState =
  | { id: string; state: "waiting"; waitingFor: string | null }
  | { id: string; state: "running" }
  | { id: string; state: "done"; design: ScreenshotDesign }
  | { id: string; state: "failed"; error: string };

/** How a design is going; a finished one carries the design. */
export const getScreenshotDesign = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ turnId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ScreenshotDesignState> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    await keepRunnerWatching();
    const [{ data: t, error }, { data: pending }] = await Promise.all([
      supabase
        .from("agent_turns")
        .select("id, status, reply, error, created_at, context, agent_chats!inner(kind)")
        .eq("id", data.turnId)
        .eq("agent_chats.kind", "translate")
        .maybeSingle(),
      supabase
        .from("agent_turns")
        .select("id, app_id, status, created_at, context, apps(name)")
        .in("status", ["queued", "running"])
        .order("created_at", { ascending: true })
        .limit(20),
    ]);
    if (error) throw new Error(error.message);
    if (!t) return { id: data.turnId, state: "failed", error: "That request is gone." };
    const row = t as any;
    if (row.status === "queued")
      return {
        id: row.id,
        state: "waiting",
        waitingFor: aheadOf({ id: row.id, createdAt: row.created_at }, pending ?? [], null),
      };
    if (row.status === "running") return { id: row.id, state: "running" };
    if (row.status !== "done")
      return {
        id: row.id,
        state: "failed",
        error: row.status === "cancelled" ? "Stopped." : (row.error ?? "Something went wrong."),
      };
    const count = Number(row.context?.count) || 1;
    const parsed = parseScreenshotDesign(row.reply, count);
    return parsed.ok
      ? { id: row.id, state: "done", design: parsed.design }
      : { id: row.id, state: "failed", error: parsed.error };
  });
