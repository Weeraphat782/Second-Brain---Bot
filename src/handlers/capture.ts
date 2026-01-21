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
  console.log(`DEBUG: handleCapture called for text: "${text.substring(0, 50)}..."`);

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
    const geminiResponse = await geminiService.analyzeThought(text, "low");

    console.log(`DEBUG: Gemini extracted ${geminiResponse.extractions.length} item(s)`);

    // PROCESS EACH EXTRACTION SEQUENTIALLY
    for (const extraction of geminiResponse.extractions) {
      console.log("DEBUG: Processing Extraction:", JSON.stringify(extraction, null, 2));

      // HANDLE QUERY INTENT
      if (extraction.intent === "query") {
        const searchQuery = extraction.search_query || text;

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
        // Continue to next extraction (don't return)
      }

      // HANDLE DELETE INTENT
      else if (extraction.intent === "delete_task" && extraction.target_task_title) {
        const deleteTerm = extraction.target_task_title;

        await slackService.updateMessage(
          channel,
          streamResult.ts,
          `🔎 Searching for tasks related to "${deleteTerm}" to remove...`
        );

        // Use search instead of single find to support "delete all from X"
        const tasksToDelete = await notionService.searchTasks(deleteTerm);

        if (tasksToDelete.length > 0) {
          await slackService.updateMessage(
            channel,
            streamResult.ts,
            `🗑️ Found ${tasksToDelete.length} task(s). Archiving now...`
          );

          // Perform batch archiving
          for (const task of tasksToDelete) {
            await notionService.archivePage(task.pageId);
          }

          await slackService.updateMessage(
            channel,
            streamResult.ts,
            `✅ Successfully removed ${tasksToDelete.length} task(s) related to "${deleteTerm}" from your Second Brain.`
          );
        } else {
          await slackService.updateMessage(
            channel,
            streamResult.ts,
            `⚠️ Could not find any tasks matching "${deleteTerm}" to delete.`
          );
        }
      }

      // HANDLE UPDATE INTENT
      else if (extraction.intent === "update_task" && extraction.target_task_title) {
        await slackService.updateMessage(
          channel,
          streamResult.ts,
          `🔎 Searching for task "${extraction.target_task_title}"...`
        );

        const task = await notionService.findPageByTitle(extraction.target_task_title);

        if (task) {
          await slackService.updateMessage(
            channel,
            streamResult.ts,
            `🔄 Found "${task.title}". Updating status...`
          );

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
        } else {
          await slackService.sendMessage(
            channel,
            `⚠️ Could not find task "${extraction.target_task_title}" for updating.`,
            ts
          );
        }
      }

      // HANDLE NEW TASK CREATION (Default)
      else if (extraction.intent === "new_task") {
        await slackService.updateMessage(
          channel,
          streamResult.ts,
          `💾 Saving "${extraction.title}" to Notion...`
        );

        const { pageId, url } = await notionService.createPageFromThought(
          extraction,
          geminiResponse.thought_signature,
          ts
        );

        console.log(`Successfully created Notion page: ${pageId}`);

        await slackService.sendNotionLink(channel, ts, url, extraction.title);
      }
    }

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
