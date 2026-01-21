import { GoogleGenerativeAI } from "@google/generative-ai";
import { getEnv } from "../config/env.js";
import type {
  ThinkingLevel,
  GeminiResponse,
  GeminiUpdateResult,
} from "../types/index.js";

export class GeminiService {
  private client: GoogleGenerativeAI;
  private modelName = "gemini-3-flash-preview";

  constructor() {
    const env = getEnv();
    this.client = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  }

  // MCP-Style Tools (Function Declarations)
  private readonly notionTools = {
    functionDeclarations: [
      {
        name: "search_tasks",
        description: "Search for existing tasks in Notion by keyword, title, assignee, or category. Returns a list of matching tasks with IDs.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: {
              type: "STRING",
              description: "The search keyword (e.g., 'Buy milk', 'View', 'P1', or 'all' for everything).",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "create_task",
        description: "Create a new task in Notion.",
        parameters: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING", description: "Short, clear task title." },
            category: { type: "STRING", enum: ["Work", "Personal", "Idea", "Health"], description: "Task category." },
            priority: { type: "STRING", enum: ["P1", "P2", "P3"], description: "Priority level (P1 is highest)." },
            dueDate: { type: "STRING", description: "ISO 8601 date string (YYYY-MM-DD)." },
            summary: { type: "STRING", description: "Brief description or details of the task." },
          },
          required: ["title"],
        },
      },
      {
        name: "update_task_status",
        description: "Update the status of a specific task in Notion using its ID.",
        parameters: {
          type: "OBJECT",
          properties: {
            pageId: { type: "STRING", description: "The Notion Page ID (UUID)." },
            status: { type: "STRING", enum: ["To Do", "In Progress", "Done"], description: "New status." },
          },
          required: ["pageId", "status"],
        },
      },
      {
        name: "archive_tasks",
        description: "Delete (archive) tasks in Notion matching a search term. Useful for batch deletion.",
        parameters: {
          type: "OBJECT",
          properties: {
            searchTerm: { type: "STRING", description: "Keyword to identify which tasks to archive." },
          },
          required: ["searchTerm"],
        },
      },
      {
        name: "add_task_note",
        description: "Append a descriptive note or update to a specific task in Notion.",
        parameters: {
          type: "OBJECT",
          properties: {
            pageId: { type: "STRING", description: "The Notion Page ID (UUID)." },
            note: { type: "STRING", description: "The text to append to the task summary." },
          },
          required: ["pageId", "note"],
        },
      },
    ],
  };

  /**
   * Process a command using Gemini's native Tool Use (Function Calling).
   * This is the "MCP-Style" agentic flow.
   */
  async startAgenticChat(text: string) {
    const now = new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" });
    const model = this.client.getGenerativeModel({
      model: this.modelName,
      tools: [this.notionTools] as any,
    });

    const chat = model.startChat({
      history: [],
      generationConfig: {
        temperature: 0.1, // Low temperature for reliable tool selection
      },
    });

    const systemPrompt = `You are the agentic core of a "Second Brain" system.
Today's date: ${now} (Asia/Bangkok).

INSTRUCTIONS:
1. You have access to Notion tools to search, create, update, and archive tasks.
2. Use these tools to fulfill User requests.
3. If a request is complex (e.g., "Find all tasks for X and mark as Done"), you can call multiple tools or call them sequentially.
4. If you need to find a task's ID before updating it, use the 'search_tasks' tool first.
5. Provide a direct, concise response to the user after your tool calls are finished.
6. For BOLD text in your final response, use *bold* (single asterisk).

User Message: "${text}"`;

    const result = await chat.sendMessage(systemPrompt);
    return {
      response: result.response,
      chat: chat,
    };
  }

  /**
   * Analyze a thought/task from Slack and extract structured data
   * @deprecated Use startAgenticChat for better MCP-style support
   */
  async analyzeThought(text: string, thinkingLevel: ThinkingLevel = "medium"): Promise<GeminiResponse> {
    const now = new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" });
    const prompt = `You are a logical parsing engine. Extract ALL tasks, queries, or deletions from the text into a JSON array. Break down complex messages into individual items.

Return JSON in this EXACT format:
{
  "extractions": [
    {
      "title": "A concise title (max 100 chars)",
      "clean_summary": "A clean summary of the thought/task (2-3 sentences)",
      "category": "One of: Work, Personal, Idea, Health",
      "priority": "One of: P1 (urgent), P2 (important), P3 (normal)",
      "due_date": "ISO 8601 date string (YYYY-MM-DD) or empty string if not specified",
      "assignee": "Name of person assigned (or null if none)",
      "intent": "One of: new_task, update_task, query, delete_task",
      "target_task_title": "If intent is update_task or delete_task, extract the name of the task being referenced. If others, null",
      "search_query": "The specific term to search for. If user wants ALL tasks, set to 'all'."
    }
  ],
  "thought_signature": "A unique hex signature (short hash) representing the OVERALL message content"
}

IMPORTANT - DATE CONTEXT:
Today is: ${now} (Asia/Bangkok)
When the user says "today", use this date.
When the user says "tomorrow", use the day after this date.
When the user says "next Monday", calculate based on this date.

IMPORTANT - Intent Detection Rules:
- "delete_task": User explicitly wants to DELETE, REMOVE, or ARCHIVE a task. 
  * Keywords (Thai): "ลบ", "เอาออก", "ลบทิ้ง", "ลบงาน".
  * Keywords (English): "delete", "remove", "archive", "destroy".
  * CRITICAL FOR target_task_title: Extract ONLY the subject or person. Remove "all tasks for", "ทุกงานของ", "ลบงาน", "@Second Brain".
- "query": User is asking a question about existing tasks, requesting a list, or checking status. Keywords: "What", "Show", "List", "Do I have", "How many", "search".
  * CRITICAL FOR search_query:
    - If the user wants a list of EVERYTHING (e.g., "list all tasks", "show all", "งานทั้งหมด"), set search_query to "all".
    - If searching for a person, use their name (e.g., "Tasks for View" -> "View").
    - If searching for a status, use the status (e.g., "P1 tasks" -> "P1").
    - Remove filler words like "tasks for", "work of", "show me", "list".
    - IGNORE bot mentions or names (e.g., "@Second Brain", "Second Brain") in the search_query.
  * If the user uses a Thai nickname, convert it to English if it's a likely match (e.g. "วิว" -> "View", "นุ่น" -> "Noon").
- "update_task": User explicitly wants to CHANGE an existing task (status, note, date). Keywords: "update", "done", "finish", "complete", "doing", "change".
- "new_task": User is engaging in a Thought/Idea or creating a TODO.

CRITICAL: If the user provides a list (bullet points, numbered list, or multiple lines), you MUST extract each item as a SEPARATE object in the "extractions" array. Do not consolidate them.

Multiple Items Example:
User: "List tasks and add 2 things: 1. Buy milk 2. Call boss"
Output: extractions array with 3 items (1 query, 2 new_tasks).

Bulleted List Example:
User: "- Task A (Due: tomorrow) \n - Task B"
Output: extractions array with 2 items (2 new_tasks).

Do not include any markdown code blocks, explanations, or text outside the JSON object. Return ONLY the JSON.

Original text: "${text}"`;

    try {
      const model = this.client.getGenerativeModel({
        model: this.modelName,
      });

      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          thinkingConfig: {
            thinkingLevel: thinkingLevel,
            includeThoughts: true,
          },
        } as any,
      });

      const responseText = result.response.text();

      // Robust JSON parsing
      let cleanResponse = responseText.trim();
      // Try to extract JSON from markdown code blocks
      const jsonCodeBlock = cleanResponse.match(/```json\s*\n?([\s\S]*?)\n?```/i);
      if (jsonCodeBlock) {
        cleanResponse = jsonCodeBlock[1].trim();
      } else {
        const genericCodeBlock = cleanResponse.match(/```\s*\n?([\s\S]*?)\n?```/);
        if (genericCodeBlock) {
          cleanResponse = genericCodeBlock[1].trim();
        }
      }

      const parsedResult = JSON.parse(cleanResponse);

      return {
        extractions: parsedResult.extractions || [],
        thought_signature: parsedResult.thought_signature || this.generateDummyHash(text),
      };
    } catch (error) {
      console.warn("JSON parsing failed, falling back to dummy response:", error);
      return {
        extractions: [
          {
            title: text.substring(0, 50),
            clean_summary: text,
            category: "Work",
            priority: "P3",
            due_date: "",
            assignee: null,
            intent: "new_task",
            target_task_title: null,
            search_query: null,
          }
        ],
        thought_signature: this.generateDummyHash(text),
      };
    }
  }

  /**
   * Generate a daily focus list summary using high thinking level
   */
  async generateFocusList(
    tasks: Array<{
      title: string;
      priority: string;
      dueDate: string;
      summary: string;
    }>
  ): Promise<string> {
    const model = this.client.getGenerativeModel({
      model: this.modelName,
    });

    const tasksText = tasks
      .map(
        (t) =>
          `- ${t.title} (${t.priority}, Due: ${t.dueDate}): ${t.summary}`
      )
      .join("\n");

    const prompt = `Generate a concise daily focus list summary from these tasks. Focus on priorities and actionable items (2-3 sentences).
    
IMPORTANT FORMATTING:
- Use Slack's mrkdwn format.
- Use *text* for bold (do NOT use **text**).
- Use bullet points (-).

Tasks for summary:
${tasksText}`;

    try {
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.5,
          thinkingConfig: {
            thinkingLevel: "high",
            includeThoughts: false, // Not needed for summary generation
          } as any,
        } as any,
      });

      return result.response.text();
    } catch (error) {
      console.error("Gemini focus list generation error:", error);
      return `Your focus list for today: ${tasks.length} task${tasks.length !== 1 ? "s" : ""} requiring attention.`;
    }
  }

  /**
   * Update task context based on thread reply
   */
  async updateWithContext(
    originalSignature: string,
    reply: string,
    originalTask?: {
      title: string;
      summary: string;
      status: string;
    }
  ): Promise<GeminiUpdateResult> {
    const model = this.client.getGenerativeModel({
      model: this.modelName,
    });

    const taskContext = originalTask
      ? `Original task: "${originalTask.title}"\nSummary: ${originalTask.summary}\nStatus: ${originalTask.status}\n\n`
      : "";

    const now = new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" });
    const prompt = `Given this task update/reply from the user, determine what action they're taking. Return JSON:
 
 {
   "action": "One of: completed, in_progress, detail, rescheduled, deleted, unchanged",
   "updates": {
     "status": "Done" or "In Progress" (only if action is "completed" or "in_progress"),
     "note": "Additional detail to append" (if action is "detail"),
     "due_date": "New ISO date YYYY-MM-DD" (if action is "rescheduled")
   },
   "thought_signature": "Updated signature if provided, otherwise empty string"
 }

IMPORTANT - DELETE RECOGNITION:
If the user says "delete this", "remove this", "ลบงานนี้", "ลบเลย", set action to "deleted".

IMPORTANT - DATE CONTEXT:
Today is: ${now} (Asia/Bangkok)
When the user mentions or implies dates (e.g. "tomorrow", "next week"), calculate based on this today's date.
 
 ${taskContext}User reply: "${reply}"`;

    try {
      const result = await model.generateContent({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: "application/json",
          thinkingConfig: {
            thinkingLevel: "medium",
            includeThoughts: true, // Required for context updates with signature
          },
        } as any,
      });

      const responseText = result.response.text();
      let updateResult: GeminiUpdateResult;

      try {
        // Try parsing directly
        updateResult = JSON.parse(responseText.trim());
      } catch (parseError) {
        // Try extracting JSON from various formats
        let jsonString: string | null = null;

        const jsonCodeBlock = responseText.match(/```json\s*\n?([\s\S]*?)\n?```/i);
        if (jsonCodeBlock) {
          jsonString = jsonCodeBlock[1].trim();
        }

        if (!jsonString) {
          const genericCodeBlock = responseText.match(/```\s*\n?([\s\S]*?)\n?```/);
          if (genericCodeBlock) {
            jsonString = genericCodeBlock[1].trim();
          }
        }

        if (!jsonString) {
          const jsonObjectMatch = responseText.match(/\{[\s\S]*\}/);
          if (jsonObjectMatch) {
            jsonString = jsonObjectMatch[0].trim();
          }
        }

        if (jsonString) {
          try {
            updateResult = JSON.parse(jsonString);
          } catch (jsonError) {
            console.error("JSON parsing failed in updateWithContext. Response:", responseText);
            // Fallback parsing
            const lowerReply = reply.toLowerCase();
            updateResult = {
              action: lowerReply.includes("done") || lowerReply.includes("complete")
                ? "completed"
                : lowerReply.includes("doing") || lowerReply.includes("progress") || lowerReply.includes("start")
                  ? "in_progress"
                  : lowerReply.includes("reschedule") || lowerReply.match(/\d{4}-\d{2}-\d{2}/)
                    ? "rescheduled"
                    : "detail",
              updates: {},
            };
          }
        } else {
          // Fallback parsing
          const lowerReply = reply.toLowerCase();
          updateResult = {
            action: lowerReply.includes("done") || lowerReply.includes("complete")
              ? "completed"
              : lowerReply.includes("doing") || lowerReply.includes("progress") || lowerReply.includes("start")
                ? "in_progress"
                : lowerReply.includes("reschedule") || lowerReply.match(/\d{4}-\d{2}-\d{2}/)
                  ? "rescheduled"
                  : "detail",
            updates: {},
          };
        }
      }

      // Preserve original signature if not provided in response
      if (!updateResult.thought_signature) {
        updateResult.thought_signature = originalSignature;
      }

      return updateResult;
    } catch (error) {
      console.error("Gemini context update error:", error);
      // Fallback: assume detail addition
      return {
        action: "detail",
        updates: { note: reply },
        thought_signature: originalSignature,
      };
    }
  }

  /**
   * Generate a dummy signature hash from text
   */
  private generateDummyHash(text: string): string {
    // Basic hash from text string for fallback
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36).substring(0, 8);
  }
  /**
   * Synthesize an answer from search results
   */
  async answerQuery(
    userQuery: string,
    tasks: any[]
  ): Promise<string> {
    const model = this.client.getGenerativeModel({
      model: this.modelName,
    });

    const tasksContext = tasks.map(t =>
      `- [${t.status}] ${t.title} (Due: ${t.dueDate || 'N/A'}, Priority: ${t.priority})`
    ).join("\n");

    const prompt = `You are a concise assistant for the user's "Second Brain".
User Question: "${userQuery}"

Found Tasks for Context:
${tasksContext || "No relevant tasks found."}

INSTRUCTIONS:
1. Answer the user's question directly and concisely based on the tasks provided.
2. DO NOT provide extra advice, opinions, or recommendations unless explicitly asked.
3. If no tasks are found, simply state that no matching tasks were found in the brain.
4. Keep the tone professional and brief.

IMPORTANT FORMATTING RULES:
- Use Slack's mrkdwn format ONLY.
- For BOLD text, use a single asterisk like this: *bold text*. 
- DO NOT use double asterisks (**text**).
- Use bullet points (-) for lists.`;

    try {
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          thinkingConfig: {
            thinkingLevel: "low",
            includeThoughts: false,
          } as any,
        } as any,
      });

      return result.response.text();
    } catch (error) {
      console.error("Gemini answer query error:", error);
      return "Sorry, I'm having trouble synthesizing an answer right now.";
    }
  }
}

export const geminiService = new GeminiService();
