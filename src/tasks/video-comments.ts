// The nightly comments brief (src/lib/video-comments.server.ts): each game with "Answer
// comments" on gets a message in its Build chat asking Claude to answer the new comments on its
// reels. Cloudflare runs it as a Cron Trigger that it shares with the reels' metrics
// (vite.config.ts), every few hours: this one only acts on the midnight run.
import { defineTask } from "nitro/task";
import { sendCommentsBriefs } from "@/lib/video-comments.server";
import { VIDEOS_NIGHT_HOUR_UTC } from "@/lib/video-comments";

export default defineTask<unknown>({
  meta: {
    name: "videos:comments",
    description: "Ask each game's Build chat to answer the new comments on its reels",
  },
  async run() {
    if (new Date().getUTCHours() !== VIDEOS_NIGHT_HOUR_UTC)
      return { result: "not the night's run" };
    return { result: await sendCommentsBriefs() };
  },
});
