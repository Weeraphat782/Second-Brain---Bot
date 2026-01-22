import { slackService } from "./services/slack.js";
import { handleCapture } from "./handlers/capture.js";
import { handleThreadUpdate } from "./handlers/threadUpdate.js";
import { setupScheduler } from "./utils/scheduler.js";
import { getEnv } from "./config/env.js";

export async function initApp() {
  console.log("DEBUG: Initializing App...");
  try {
    // Validate environment
    getEnv();

    const app = slackService.getApp();

    // Handle DMs and mentions
    app.event("app_mention", async ({ event, say }) => {
      console.log("DEBUG: app_mention event:", JSON.stringify(event, null, 2));

      const text = event.text.trim();

      // 🧪 TESTING TRIGGERS (Accessible via mention)
      if (text.includes("test morning")) {
        await say("🚀 Triggering Morning Briefing manually...");
        await import("./handlers/briefings.js").then(m => m.sendMorningBriefing());
        return;
      }
      if (text.includes("test nightly")) {
        await say("🚀 Triggering Nightly Review manually...");
        await import("./handlers/briefings.js").then(m => m.sendNightlyReview());
        return;
      }

      // If this mention is inside a thread, treat it as an update, not a new capture
      if (event.thread_ts) {
        await handleThreadUpdate({
          channel: event.channel,
          user: event.user || "",
          text: event.text,
          ts: event.ts,
          thread_ts: event.thread_ts,
          event_ts: event.event_ts,
        });
      } else {
        await handleCapture({
          channel: event.channel,
          user: event.user || "",
          text: event.text,
          ts: event.ts,
          thread_ts: event.thread_ts,
          event_ts: event.event_ts,
        });
      }
    });

    app.message(async ({ message, say }) => {
      // Skip bot messages and message updates (editing)
      if (
        (message as any).subtype === "bot_message" ||
        (message as any).bot_id ||
        (message as any).subtype === "message_changed"
      ) {
        return;
      }

      const msg = message as any;
      if (!msg.text) return;
      const text = msg.text.trim();

      // 🧪 TESTING TRIGGERS (Accessible via DM)
      if (text === "test morning") {
        await say("🚀 Triggering Morning Briefing manually...");
        await import("./handlers/briefings.js").then(m => m.sendMorningBriefing());
        return;
      }
      if (text === "test nightly") {
        await say("🚀 Triggering Nightly Review manually...");
        await import("./handlers/briefings.js").then(m => m.sendNightlyReview());
        return;
      }

      // Handle DMs (message in IM channel)
      const channelType = (message as any).channel_type;
      if (channelType === "im" || !(message as any).subtype) {
        const msg = message as any;

        // Check if this is a thread reply
        if (msg.thread_ts) {
          await handleThreadUpdate({
            channel: msg.channel,
            user: msg.user,
            text: msg.text || "",
            ts: msg.ts,
            thread_ts: msg.thread_ts,
            event_ts: msg.ts,
          });
        } else {
          await handleCapture({
            channel: msg.channel,
            user: msg.user,
            text: msg.text || "",
            ts: msg.ts,
            thread_ts: undefined,
            event_ts: msg.ts,
          });
        }
      }
    });

    // Handle action button interactions (for nightly review)
    // Handle Action Button Interactions
    app.action("task_done", async ({ ack, respond }) => {
      await ack();
      await respond("Task marked as done!");
    });

    // 🧪 TESTING COMMANDS (Manual Triggers)
    app.command("/test-morning", async ({ ack }) => {
      await ack();
      console.log("手动 Trigger Morning Briefing...");
      await import("./handlers/briefings.js").then(m => m.sendMorningBriefing());
    });

    app.command("/test-nightly", async ({ ack }) => {
      await ack();
      console.log("手动 Trigger Nightly Review...");
      await import("./handlers/briefings.js").then(m => m.sendNightlyReview());
    });

    app.action("task_reschedule", async ({ ack, respond }) => {
      await ack();
      // Handle reschedule action - would prompt for new date
      await respond("Reschedule feature coming soon!");
    });

    app.action("task_add_note", async ({ ack, respond }) => {
      await ack();
      // Handle add note action - would prompt for note
      await respond("Add note feature coming soon!");
    });

    // Set up daily briefings scheduler
    setupScheduler();

    // Start the app
    await slackService.start();

    console.log("✅ AI Second Brain listeners registered!");
    return app;
  } catch (error) {
    console.error("Failed to initialize application:", error);
    throw error;
  }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down gracefully...");
  await slackService.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\nShutting down gracefully...");
  await slackService.stop();
  process.exit(0);
});

// main() call removed for Vercel/Module compatibility
// If not running in a serverless environment, you can call it at the bottom:
if (process.env.VERCEL !== "1" && process.env.NODE_ENV !== "test") {
  initApp().catch(err => {
    console.error("Failed to start:", err);
    process.exit(1);
  });
}
