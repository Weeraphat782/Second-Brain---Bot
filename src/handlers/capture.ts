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

    // START AGENTIC CHAT (MCP-Style)
    await slackService.updateMessage(channel, streamResult.ts, "🧠 Thinking agentically...");

    let { response, chat } = await geminiService.startAgenticChat(text);

    // LOOP TO HANDLE TOOL CALLS (MULTIPLE TURNS IF NECESSARY)
    let callCount = 0;
    const MAX_CALLS = 5;

    while (response.functionCalls()?.length && callCount < MAX_CALLS) {
      callCount++;
      const functionCalls = response.functionCalls();
      if (!functionCalls) break;

      const functionResponses = [];

      for (const call of functionCalls) {
        console.log(`DEBUG: Agentic Tool Call: ${call.name}`, call.args);

        // Inform user of tool usage
        await slackService.updateMessage(channel, streamResult.ts, `🛠️ Executing: ${call.name}...`);

        let result;
        try {
          switch (call.name) {
            case "search_tasks":
              const tasks = await notionService.searchTasks((call.args as any).query);
              result = { tasks }; // Wrap array in object
              break;
            case "create_task":
              const createTaskArgs = call.args as any;
              const createdPage = await notionService.createPageFromThought(
                {
                  title: createTaskArgs.title,
                  category: createTaskArgs.category || "Work",
                  priority: createTaskArgs.priority || "P3",
                  due_date: createTaskArgs.dueDate || "",
                  clean_summary: createTaskArgs.summary || "",
                  assignee: null,
                  intent: "new_task",
                  target_task_title: null,
                  search_query: null
                },
                "agentic_create",
                ts
              );
              result = { success: true, pageId: createdPage.pageId, url: createdPage.url };
              break;
            case "update_task_status":
              await notionService.updatePageStatus((call.args as any).pageId, (call.args as any).status);
              result = { success: true };
              break;
            case "archive_tasks":
              const tasksToArchive = await notionService.searchTasks((call.args as any).searchTerm);
              for (const t of tasksToArchive) {
                await notionService.archivePage(t.pageId);
              }
              result = { success: true, archivedCount: tasksToArchive.length };
              break;
            case "add_task_note":
              await notionService.appendNote((call.args as any).pageId, (call.args as any).note);
              result = { success: true };
              break;
            default:
              result = { error: "Unknown tool" };
          }
        } catch (error) {
          console.error(`Tool execution failed (${call.name}):`, error);
          result = { error: error instanceof Error ? error.message : String(error) };
        }

        functionResponses.push({
          functionResponse: {
            name: call.name,
            response: result
          },
        });
      }

      // Send results back to Gemini for next step
      const nextStep = await chat.sendMessage(functionResponses);
      response = nextStep.response;
    }

    // FINAL RESPONSE
    const finalAnswer = response.text();
    await slackService.updateMessage(
      channel,
      streamResult.ts,
      finalAnswer
    );

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
