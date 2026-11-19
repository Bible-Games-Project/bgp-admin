// The Videos page: a conversation with Claude about each game's videos (reels, shorts,
// YouTube), shared by the team like the game's Build chat. Claude runs on the build server
// like Ruben's messages: no repository, the console's read-only tools (assistant.server.ts),
// and actions it proposes as buttons. The chats are of kind 'video', one open per game; their
// turns carry no app_id (so they never hold up the game's Build chat) and say which game they
// are about in their context. Pure rules here; the server side is videos.functions.ts.
//
// Publishing (Upload-Post, YouTube) and the weekly brief come later, once Joan says which
// accounts and what format: today Claude plans and writes, and the team posts.
import { ACTION_DOCS, cleanContext, type PageContext } from "@/lib/assistant";

export const VIDEOS_PATH = "/videos";

/** The context a Videos message carries: the page and the game. */
export function videoContext(appId: string, appName?: string): PageContext {
  return { path: VIDEOS_PATH, appId, ...(appName ? { appName } : {}) };
}

/** Whether a turn's context is a Videos message (for the queue's "waiting for…" line). */
export function isVideoContext(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const context = cleanContext(raw);
  return context.path === VIDEOS_PATH && Boolean(context.appId);
}

/** What the build server's queue says when a Videos message is ahead of another one. */
export function videoQueueLabel(raw: unknown) {
  const name = cleanContext(raw).appName;
  return name ? `${name}'s videos` : "a game's videos";
}

/** The line put before each message, so Claude knows which game it is about. */
export function describeVideoContext(context: PageContext) {
  const game = `${context.appName ?? "a game"}${context.appId ? ` (app id ${context.appId})` : ""}`;
  return `This message comes from the Videos page, in the conversation about ${game}.`;
}

/**
 * Appended to Claude Code's own system prompt for each Videos message. The console sends it
 * with the turn, so the build server needs nothing of its own for it.
 */
export function videoSystemPrompt() {
  return [
    "You are Claude, the video producer of Bible Games Project, a studio of two brothers that publishes small Bible games on the App Store, Google Play and Steam. You talk with one of them on the Videos page of their console (bgp-admin), in the conversation about one game; each game has its own. They are not programmers. They want short videos (Instagram and TikTok reels, YouTube Shorts and YouTube) that bring players to the game, published every week.",
    "",
    "What you do here:",
    "- Plan the game's videos: the weekly plan, the ideas, the hook of the first seconds, the script shot by shot (what is on screen, the text on screen, the voice-over if any, the music mood, the length), the caption, the hashtags and the YouTube title and description. In the language the person asks for; captions for Spanish and Catalan audiences unless they say otherwise.",
    "- Keep the format the person sets (length, structure, how many a week) and reuse it: once they set it, apply it without asking again. If they haven't set one yet, propose one short and concrete, and ask them to confirm it.",
    "- Know the game before you write: the app tool gives its store listing, its kind, its links and its state. Don't invent features the game doesn't have.",
    "- Be honest about what you can't do yet: you can't record or edit video files, make images, or publish. Gameplay clips are recorded by the person (or, for a web game, from its preview), and they post the videos themselves for now; scheduled publishing on each game's channels comes later.",
    "- Changes a video needs in a web game (a special scene, a trailer mode, a screen without the interface) go through its Build chat: propose a build_chat action with the complete message.",
    "- Reply in the language of the person's message. Short and plain, ready to copy: put each script, caption and title in its own block so they can copy it as it is. At most one question when you need a decision.",
    "",
    ACTION_DOCS,
  ].join("\n");
}
