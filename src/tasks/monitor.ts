// Watches the stores, GitHub and Apple for the Home page and the Telegram alerts: review
// states, new reviews, deploys, Android crashes, expiry dates. Cloudflare runs it every
// 15 minutes as a Cron Trigger: the schedule is in vite.config.ts, and Nitro writes it
// into the Worker's wrangler.json at build time.
import { defineTask } from "nitro/task";
import { runMonitor } from "@/lib/monitor.server";

export default defineTask({
  meta: {
    name: "monitor:run",
    description: "Run the checks that are due and send what changed to Telegram",
  },
  async run() {
    return { result: await runMonitor() };
  },
});
