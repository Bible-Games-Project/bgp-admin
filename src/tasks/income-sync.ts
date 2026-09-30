// Reads the stores' new sales reports into the database the Revenue page loads from.
// Cloudflare runs it every hour as a Cron Trigger: the schedule is in vite.config.ts,
// and Nitro writes it into the Worker's wrangler.json at build time.
import { defineTask } from "nitro/task";
import { syncIncome } from "@/lib/income-sync.server";

export default defineTask({
  meta: {
    name: "income:sync",
    description: "Read the App Store and Google Play reports the database lacks",
  },
  async run() {
    return { result: await syncIncome() };
  },
});
