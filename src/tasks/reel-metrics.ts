// The published reels' metrics (src/lib/reel-metrics.server.ts): every few hours the console
// reads the metrics of a few reels from Upload-Post. Cloudflare runs it as a Cron Trigger that
// it shares with the comments brief (vite.config.ts): this one skips the midnight run, which
// is the comments brief's, so each has the run's 50 requests to itself.
import { defineTask } from "nitro/task";
import { refreshReelMetrics } from "@/lib/reel-metrics.server";
import { VIDEOS_NIGHT_HOUR_UTC } from "@/lib/video-comments";

export default defineTask<unknown>({
  meta: {
    name: "videos:metrics",
    description: "Read the published reels' metrics from Upload-Post",
  },
  async run() {
    if (new Date().getUTCHours() === VIDEOS_NIGHT_HOUR_UTC)
      return { result: "the comments brief's run" };
    return { result: await refreshReelMetrics() };
  },
});
