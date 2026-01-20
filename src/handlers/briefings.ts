import { slackService } from "../services/slack.js";
import { geminiService } from "../services/gemini.js";
import { notionService } from "../services/notion.js";
import { getEnv } from "../config/env.js";

/**
 * Generate and send morning focus briefing
 * Runs at 08:00 AM
 */
export async function sendMorningBriefing(): Promise<void> {
  const env = getEnv();
  const channel = env.BRIEFING_CHANNEL_ID || "";

  if (!channel) {
    console.warn("BRIEFING_CHANNEL_ID not set, skipping morning briefing");
    return;
  }

  try {
    // Query due tasks
    const dueTasks = await notionService.queryDueTasks();

    if (dueTasks.length === 0) {
      await slackService.sendMessage(
        channel,
        "🌅 *Good Morning!*\n\nNo tasks due today. Have a productive day!"
      );
      return;
    }

    // Generate focus list summary using Gemini with high thinking level
    const focusListText = await geminiService.generateFocusList(
      dueTasks.map((task) => ({
        title: task.title,
        priority: task.priority,
        dueDate: task.dueDate || "No due date",
        summary: task.summary,
      }))
    );

    // Format message
    const taskList = dueTasks
      .map(
        (task) =>
          `• *${task.title}* (${task.priority})${task.dueDate ? ` - Due: ${task.dueDate}` : ""}`
      )
      .join("\n");

    const message = `🌅 *Daily Briefing - Morning Focus*\n\n${focusListText}\n\n*Tasks Due Today:*\n${taskList}`;

    await slackService.sendMessage(channel, message);
    console.log(`Morning briefing sent with ${dueTasks.length} tasks`);
  } catch (error) {
    console.error("Morning briefing error:", error);
  }
}

/**
 * Generate and send nightly review
 * Runs at 09:00 PM with action buttons
 */
export async function sendNightlyReview(): Promise<void> {
  const env = getEnv();
  const channel = env.BRIEFING_CHANNEL_ID || "";

  if (!channel) {
    console.warn("BRIEFING_CHANNEL_ID not set, skipping nightly review");
    return;
  }

  try {
    // Query tasks modified/created today
    const todayTasks = await notionService.queryModifiedToday();

    if (todayTasks.length === 0) {
      await slackService.sendMessage(
        channel,
        "🌙 *Nightly Review*\n\nNo tasks were added or modified today."
      );
      return;
    }

    // Format task list
    const taskList = todayTasks
      .map(
        (task) =>
          `• *${task.title}* (${task.category}, ${task.priority}) - Status: ${task.status}`
      )
      .join("\n");

    const message = `🌙 *Nightly Review*\n\nHere's what happened today:\n\n${taskList}\n\n_Use the buttons below to manage tasks._`;

    // Note: Action buttons would need to be handled with interactive callbacks
    // For now, we'll send a simple message
    // In a full implementation, you'd use sendMessageWithButtons with callback handlers
    await slackService.sendMessage(channel, message);

    console.log(`Nightly review sent with ${todayTasks.length} tasks`);
  } catch (error) {
    console.error("Nightly review error:", error);
  }
}
