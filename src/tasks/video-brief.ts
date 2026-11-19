// The weekly reels brief (src/lib/video-brief.server.ts): on Sunday night, each game with
// weekly reels on gets a message in its Videos conversation asking for next week's reels.
// Cloudflare runs it as a Cron Trigger: the schedule is in vite.config.ts, and Nitro writes
// it into the Worker's wrangler.json at build time.
import { defineTask } from "nitro/task";
import { sendWeeklyBriefs } from "@/lib/video-brief.server";

export default defineTask({
  meta: {
    name: "videos:brief",
    description: "Ask each game's Videos conversation for next week's reels",
  },
  async run() {
    return { result: await sendWeeklyBriefs() };
  },
});
