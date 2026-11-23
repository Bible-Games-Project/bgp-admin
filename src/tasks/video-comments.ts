// The nightly comments brief (src/lib/video-comments.server.ts): each game with "Answer
// comments" on gets a message in its Build chat asking Claude to answer the new comments on its
// reels. Cloudflare runs it as a Cron Trigger: the schedule is in vite.config.ts.
import { defineTask } from "nitro/task";
import { sendCommentsBriefs } from "@/lib/video-comments.server";

export default defineTask({
  meta: {
    name: "videos:comments",
    description: "Ask each game's Build chat to answer the new comments on its reels",
  },
  async run() {
    return { result: await sendCommentsBriefs() };
  },
});
