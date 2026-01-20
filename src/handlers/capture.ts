import { slackService } from "../services/slack.js";
import { geminiService } from "../services/gemini.js";
import { notionService } from "../services/notion.js";
import type { SlackMessageEvent } from "../types/index.js";

/**
 * Handle intelligent capture from Slack message
 * Flow: Slack -> Gemini -> Notion -> Slack confirmation
 */
export async function handleCapture(event: SlackMessageEvent): Promise<void> {
  const { channel, text, ts, thread_ts } = event;

  try {
    // Check if this is a thread reply (should be handled separately)
    if (thread_ts) {
      // Thread replies are handled by threadUpdate handler
      return;
    }

    // Send initial processing message
    const streamResult = await slackService.startStreamingResponse(
      channel,
      "🤔 Understanding your request..."
    );

    // Analyze thought with Gemini (low thinking level for speed)
    console.log("DEBUG: Starting Gemini analysis for text:", text);
    const geminiResponse = await geminiService.analyzeThought(text, "low");
    console.log("DEBUG: Gemini analysis complete.");

    console.log("DEBUG: Gemini Extraction:", JSON.stringify(geminiResponse.extraction, null, 2));

    // HANDLE QUERY INTENT
    if (geminiResponse.extraction.intent === "query") {
      const searchQuery = geminiResponse.extraction.search_query || text;

      await slackService.updateMessage(
        channel,
        streamResult.ts,
        `🔎 Searching Notion for "${searchQuery}"...`
      );

      const tasks = await notionService.searchTasks(searchQuery);
      console.log(`DEBUG: Found ${tasks.length} tasks for query "${searchQuery}"`);

      await slackService.updateMessage(
        channel,
        streamResult.ts,
        `🤔 Analyzing ${tasks.length} found tasks...`
      );

      const answer = await geminiService.answerQuery(text, tasks);

      await slackService.updateMessage(
        channel,
        streamResult.ts,
        answer
      );
      return;
    }

    // HANDLE UPDATE INTENT
    if (geminiResponse.extraction.intent === "update_task" && geminiResponse.extraction.target_task_title) {
      await slackService.updateMessage(
        channel,
        streamResult.ts,
        `🔎 Searching for task "${geminiResponse.extraction.target_task_title}"...`
      );

      const task = await notionService.findPageByTitle(geminiResponse.extraction.target_task_title);

      if (task) {
        // Reuse thread update logic (simulated)
        // We trigger the update logic manually
        await slackService.updateMessage(
          channel,
          streamResult.ts,
          `🔄 Found "${task.title}". Updating status...`
        );

        // Analyze specific update action needed using the updateWithContext logic
        // We reuse the updateWithContext but pass the full text as the "reply"
        // and using the found task's details
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
          await slackService.updateMessage(
            channel,
            streamResult.ts,
            `✅ Updated "${task.title}" to Done!`
          );
        } else if (updateResult.action === "in_progress") {
          await notionService.updatePageStatus(task.pageId, "In Progress");
          await slackService.updateMessage(
            channel,
            streamResult.ts,
            `🚀 Updated "${task.title}" to In Progress!`
          );
        } else if (updateResult.action === "detail") {
          const note = updateResult.updates?.note || text;
          await notionService.appendNote(task.pageId, note);
          await slackService.updateMessage(
            channel,
            streamResult.ts,
            `📝 Added note to "${task.title}"`
          );
        } else if (updateResult.action === "rescheduled") {
          const newDueDate = updateResult.updates?.due_date;
          if (newDueDate) {
            await notionService.updateDueDate(task.pageId, newDueDate);
            await slackService.updateMessage(
              channel,
              streamResult.ts,
              `📅 Rescheduled "${task.title}" to ${newDueDate}`
            );
          }
        } else {
          await slackService.updateMessage(
            channel,
            streamResult.ts,
            `👌 Acknowledged update for "${task.title}"`
          );
        }

        return;
      } else {
        // Task not found - Fallback to creating new?
        // Let's inform the user and ask them to be specific? 
        // Or for now, just silently fall through to create a new task but warn them?
        await slackService.sendMessage(
          channel,
          `⚠️ Could not find task "${geminiResponse.extraction.target_task_title}". Creating a new task instead...`,
          ts
        );
        // Continue to create new task logic...
      }
    }

    // HANDLE NEW TASK CREATION (Default)
    // Update message to show progress
    console.log("DEBUG: Handling new task creation...");
    await slackService.updateMessage(
      channel,
      streamResult.ts,
      "💾 Saving to Notion..."
    );

    // Create Notion page
    console.log("DEBUG: Calling notionService.createPageFromThought...");
    const { pageId, url } = await notionService.createPageFromThought(
      geminiResponse.extraction,
      geminiResponse.thought_signature,
      ts
    );
    console.log(`DEBUG: Notion page created successfully: ${pageId}`);

    // Send confirmation with Notion link
    await slackService.sendNotionLink(channel, ts, url, geminiResponse.extraction.title);

    console.log(`Captured thought: ${geminiResponse.extraction.title} -> ${pageId}`);
  } catch (error) {
    console.error("Capture handler error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await slackService.sendMessage(
      channel,
      `❌ Failed to capture thought: ${errorMessage}`,
      thread_ts || ts
    );
  }
}
