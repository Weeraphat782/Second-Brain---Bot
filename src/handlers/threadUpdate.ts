import { slackService } from "../services/slack.js";
import { geminiService } from "../services/gemini.js";
import { notionService } from "../services/notion.js";
import type { SlackMessageEvent } from "../types/index.js";

/**
 * Handle thread-based updates
 * Flow: Slack thread reply -> Gemini (with signature) -> Notion update
 */
export async function handleThreadUpdate(
  event: SlackMessageEvent
): Promise<void> {
  const { channel, text, thread_ts } = event;

  if (!thread_ts) {
    return; // Not a thread reply
  }

  try {
    // Find the Notion page associated with this thread
    const task = await notionService.findPageByThreadTS(thread_ts);

    if (!task) {
      await slackService.sendMessage(
        channel,
        "⚠️ Could not find the original thought for this thread.",
        thread_ts
      );
      return;
    }

    if (!task.thoughtSignature) {
      await slackService.sendMessage(
        channel,
        "⚠️ Missing thought signature for this task. Update may not work correctly.",
        thread_ts
      );
    }

    // Send processing indicator
    await slackService.sendMessage(
      channel,
      "🔄 Analyzing your update...",
      thread_ts
    );

    // Get context update from Gemini
    const updateResult = await geminiService.updateWithContext(
      task.thoughtSignature || "",
      text,
      {
        title: task.title,
        summary: task.summary,
        status: task.status,
      }
    );

    // Apply updates to Notion
    if (updateResult.action === "completed") {
      await notionService.updatePageStatus(task.pageId, "Done");
      await slackService.sendMessage(
        channel,
        "✅ Task marked as done!",
        thread_ts
      );
    } else if (updateResult.action === "in_progress") {
      await notionService.updatePageStatus(task.pageId, "In Progress");
      await slackService.sendMessage(
        channel,
        "🚀 Status updated to In Progress!",
        thread_ts
      );
    } else if (updateResult.action === "detail") {
      const note = updateResult.updates?.note || text;
      await notionService.appendNote(task.pageId, note);
      await slackService.sendMessage(
        channel,
        `📝 Added note: "${note.substring(0, 100)}${note.length > 100 ? "..." : ""}"`,
        thread_ts
      );
    } else if (updateResult.action === "rescheduled") {
      const newDueDate = updateResult.updates?.due_date;
      if (newDueDate) {
        await notionService.updateDueDate(task.pageId, newDueDate);
        await slackService.sendMessage(
          channel,
          `📅 Rescheduled to ${newDueDate}`,
          thread_ts
        );
      }
    } else if (updateResult.action === "deleted") {
      await notionService.archivePage(task.pageId);
      await slackService.sendMessage(
        channel,
        "🗑️ Task has been archived/removed.",
        thread_ts
      );
    } else {
      // unchanged - just acknowledge
      await slackService.sendMessage(
        channel,
        "Got it!",
        thread_ts
      );
    }

    // Update thought signature if provided
    if (updateResult.thought_signature && updateResult.thought_signature !== task.thoughtSignature) {
      // Could update the signature in Notion if needed
      // For now, we'll keep using the original
    }

    console.log(`Thread update processed: ${task.pageId} -> ${updateResult.action}`);
  } catch (error) {
    console.error("Thread update handler error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await slackService.sendMessage(
      channel,
      `❌ Failed to process update: ${errorMessage}`,
      thread_ts
    );
  }
}
