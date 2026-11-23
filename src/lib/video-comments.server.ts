// The nightly comments brief (video-comments.ts): for each web game with "Answer comments" on,
// a message in its Build chat asks Claude to answer the new comments on the game's reels at
// Upload-Post. Run by the Cron Trigger in src/tasks/video-comments.ts, and by the Videos page's
// "Answer now" button.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isSelfRepo } from "@/lib/self-repo";
import { isWebGame } from "@/lib/app-kind";
import { keepRunnerWatching } from "@/lib/agent.server";
import { repoJson } from "@/lib/repo-json.server";
import { CHANNEL_PATH, readChannel } from "@/lib/scheduled-reels";
import {
  COMMENTS_BRIEF_PURPOSE,
  commentsBriefIsDue,
  commentsBriefPrompt,
} from "@/lib/video-comments";
import {
  assertClaudeReady,
  chatIsBusy,
  ensureBuildChat,
  type BriefOutcome,
} from "@/lib/video-brief.server";

const db = () => supabaseAdmin as any;

/**
 * Sends the comments brief to one game, or says why not. `force` sends it even if the game's
 * "Answer comments" is off (the page's button).
 */
export async function sendCommentsBrief(
  appId: string,
  { force = false, userId = null as string | null, email = null as string | null } = {},
): Promise<BriefOutcome> {
  const [{ data: app }, { data: settings }] = await Promise.all([
    db()
      .from("apps")
      .select("id, name, github_owner, github_repo, default_ref")
      .eq("id", appId)
      .maybeSingle(),
    db().from("video_settings").select("answer_comments").eq("app_id", appId).maybeSingle(),
  ]);
  const name = app?.name ?? "this game";
  const result = (outcome: string) => ({ appId, app: name, outcome });
  if (!app) return result("not in the console any more");
  if (!isWebGame(app) || isSelfRepo(app.github_owner, app.github_repo))
    throw new Error("Only a web game's Build chat can answer its reels' comments.");
  if (!force && !commentsBriefIsDue(settings)) return result("answering comments is off");

  await assertClaudeReady();
  const chat = await ensureBuildChat(app.id, userId);
  if (await chatIsBusy(chat.id))
    throw new Error(
      `${name}'s Build chat is still on a message. Try again when it ends (the nightly run tries again the next night).`,
    );
  const channel = await repoJson(app, CHANNEL_PATH).catch(() => undefined);
  const { error } = await db()
    .from("agent_turns")
    .insert({
      chat_id: chat.id,
      app_id: app.id,
      prompt: commentsBriefPrompt(readChannel(channel).profile),
      context: { purpose: COMMENTS_BRIEF_PURPOSE },
      created_by: userId,
      created_by_email: email,
    });
  if (error) throw new Error(error.message);
  await keepRunnerWatching();
  return result("brief sent to the Build chat");
}

/** The nightly run: every active game with "Answer comments" on. One failing doesn't stop the rest. */
export async function sendCommentsBriefs() {
  const { data, error } = await db()
    .from("video_settings")
    .select("app_id, apps!inner(is_active)")
    .eq("answer_comments", true)
    .eq("apps.is_active", true);
  if (error) throw new Error(error.message);
  const outcomes: BriefOutcome[] = [];
  for (const row of data ?? []) {
    try {
      outcomes.push(await sendCommentsBrief(row.app_id));
    } catch (e) {
      outcomes.push({ appId: row.app_id, app: row.app_id, outcome: (e as Error).message });
    }
  }
  return outcomes;
}

/** When a game's Build chat last got the comments brief, and how that message went. */
export async function lastCommentsBrief(appId: string) {
  const { data } = await db()
    .from("agent_turns")
    .select("id, status, created_at, finished_at")
    .eq("app_id", appId)
    .eq("context->>purpose", COMMENTS_BRIEF_PURPOSE)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data ?? null) as {
    id: string;
    status: string;
    created_at: string;
    finished_at: string | null;
  } | null;
}
