// The weekly brief (video-reels.ts): on Sunday night, for each game with weekly reels on and
// no plan yet for next week, a message in its Videos conversation asks Claude for next week's
// reels. Run by the Cron Trigger in src/tasks/video-brief.ts, and by the Videos page's
// "Plan next week now" button for one game.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { AGENT_SETTING_KEYS, accountFrom, agentSettingsFrom } from "@/lib/agent";
import { keepRunnerWatching, weeklyBudgetNow } from "@/lib/agent.server";
import { videoContext } from "@/lib/videos";
import { briefIsDue, nextWeekOf, weeklyBriefPrompt } from "@/lib/video-reels";

const db = () => supabaseAdmin as any;

/** The game's open Videos conversation, started if it has none. */
export async function ensureVideoChat(appId: string, userId: string | null) {
  const find = async () => {
    const { data, error } = await db()
      .from("agent_chats")
      .select("id, created_at")
      .eq("kind", "video")
      .eq("app_id", appId)
      .is("archived_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as { id: string; created_at: string } | null;
  };
  const open = await find();
  if (open) return open;
  const created = await db()
    .from("agent_chats")
    .insert({ kind: "video", app_id: appId, created_by: userId })
    .select("id, created_at")
    .single();
  // Two at once: the other one won.
  const chat = created.data ?? (await find());
  if (!chat) throw new Error(created.error?.message ?? "Couldn't start the chat.");
  return chat as { id: string; created_at: string };
}

export async function chatIsBusy(chatId: string) {
  const { data } = await db()
    .from("agent_turns")
    .select("id")
    .eq("chat_id", chatId)
    .in("status", ["queued", "running"])
    .limit(1);
  return Boolean(data?.length);
}

type BriefOutcome = { appId: string; app: string; outcome: string };

/**
 * Sends the weekly brief to one game, or says why not. `force` sends it even if the game's
 * weekly reels are off or next week already has a plan (the page's button).
 */
export async function sendWeeklyBrief(
  appId: string,
  {
    now = new Date(),
    force = false,
    userId = null as string | null,
    email = null as string | null,
  } = {},
): Promise<BriefOutcome> {
  const weekOf = nextWeekOf(now);
  const [{ data: app }, { data: settings }, { count }] = await Promise.all([
    db().from("apps").select("id, name, is_active").eq("id", appId).maybeSingle(),
    db().from("video_settings").select("weekly_reels, format").eq("app_id", appId).maybeSingle(),
    db()
      .from("video_reels")
      .select("id", { count: "exact", head: true })
      .eq("app_id", appId)
      .eq("week_of", weekOf)
      .neq("status", "discarded"),
  ]);
  const name = app?.name ?? "this game";
  const result = (outcome: string) => ({ appId, app: name, outcome });
  if (!app) return result("not in the console any more");
  if (!force && !briefIsDue(settings, count ?? 0))
    return result(settings?.weekly_reels ? "next week is already planned" : "weekly reels are off");

  const [{ data: runner }, { data: rows }] = await Promise.all([
    db().from("agent_runner").select("account, usage").eq("id", "main").maybeSingle(),
    db().from("app_settings").select("key, value").in("key", AGENT_SETTING_KEYS),
  ]);
  const account = accountFrom(runner?.account);
  if (!account) throw new Error("No Claude account is linked yet. Link one in Settings → Claude.");
  if (account.rejectedAt)
    throw new Error(
      "Claude no longer accepts the linked account. Link it again in Settings → Claude.",
    );
  const budget = await weeklyBudgetNow(
    agentSettingsFrom(rows ?? []).weeklyBudgetPercent,
    runner?.usage ?? null,
  );
  if (budget.exhausted) throw new Error("The weekly share of Claude is used up.");

  const chat = await ensureVideoChat(app.id, userId);
  if (await chatIsBusy(chat.id))
    throw new Error(
      "Claude is still on the last message of this game's videos. Try again when it ends.",
    );
  const { error } = await db()
    .from("agent_turns")
    .insert({
      chat_id: chat.id,
      app_id: null,
      prompt: weeklyBriefPrompt(weekOf, settings?.format ?? ""),
      context: videoContext(app.id, app.name),
      created_by: userId,
      created_by_email: email,
    });
  if (error) throw new Error(error.message);
  await keepRunnerWatching();
  return result("brief sent");
}

/** The Sunday-night run: every game with weekly reels on. One game failing doesn't stop the rest. */
export async function sendWeeklyBriefs(now = new Date()) {
  const { data, error } = await db()
    .from("video_settings")
    .select("app_id, apps!inner(is_active)")
    .eq("weekly_reels", true)
    .eq("apps.is_active", true);
  if (error) throw new Error(error.message);
  const outcomes: BriefOutcome[] = [];
  for (const row of data ?? []) {
    try {
      outcomes.push(await sendWeeklyBrief(row.app_id, { now }));
    } catch (e) {
      outcomes.push({ appId: row.app_id, app: row.app_id, outcome: (e as Error).message });
    }
  }
  return outcomes;
}
