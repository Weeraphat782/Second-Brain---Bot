import cron from "node-cron";
import { sendMorningBriefing, sendNightlyReview } from "../handlers/briefings.js";
import { getEnv } from "../config/env.js";

/**
 * Set up daily briefing cron jobs
 * Morning: 08:00 AM
 * Nightly: 09:00 PM
 */
export function setupScheduler(): void {
  const env = getEnv();
  const timezone = env.TIMEZONE || "UTC";

  // Morning briefing at 08:00
  cron.schedule(
    "0 8 * * *",
    async () => {
      console.log(`[${new Date().toISOString()}] Running morning briefing...`);
      try {
        await sendMorningBriefing();
      } catch (error) {
        console.error("Scheduled morning briefing failed:", error);
      }
    },
    {
      timezone,
    }
  );

  // Nightly review at 21:00 (9 PM)
  cron.schedule(
    "0 21 * * *",
    async () => {
      console.log(`[${new Date().toISOString()}] Running nightly review...`);
      try {
        await sendNightlyReview();
      } catch (error) {
        console.error("Scheduled nightly review failed:", error);
      }
    },
    {
      timezone,
    }
  );

  console.log(`Scheduler configured for timezone: ${timezone}`);
  console.log("Morning briefing: 08:00");
  console.log("Nightly review: 21:00");
}
