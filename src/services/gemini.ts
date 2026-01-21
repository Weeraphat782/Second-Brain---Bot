import { GoogleGenerativeAI } from "@google/generative-ai";
import { getEnv } from "../config/env.js";
import type {
  ThinkingLevel,
  GeminiResponse,
  GeminiUpdateResult,
  ThoughtExtraction,
} from "../types/index.js";

export class GeminiService {
  private client: GoogleGenerativeAI;
  private modelName = "gemini-3-flash-preview";

  constructor() {
    const env = getEnv();
    this.client = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  }

  /**
   * Analyze a thought/task from Slack and extract structured data
   */
  async analyzeThought(
    text: string,
    thinkingLevel: ThinkingLevel = "low"
  ): Promise<GeminiResponse> {
    const model = this.client.getGenerativeModel({
      model: this.modelName,
    });

    const now = new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" });
    const prompt = `Analyze the following thought/task and extract structured information. Return ONLY a valid JSON object with no additional text, comments, or markdown formatting. The JSON must match this exact structure:

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

Examples:
- "ลบงานของวิวทั้งหมด" -> intent: "delete_task", target_task_title: "View"
- "ลบงาน Buy Milk" -> intent: "delete_task", target_task_title: "Buy Milk"
- "Remove the task for Client X" -> intent: "delete_task", target_task_title: "Client X"
- "List all tasks" -> intent: "query", search_query: "all"
- "งานทั้งหมดมีอะไรบ้าง" -> intent: "query", search_query: "all"
- "Update Client X to Done" -> intent: "update_task", target_task_title: "Client X"

Do not include any markdown code blocks, explanations, or text outside the JSON object. Return ONLY the JSON.

Original text: "${text}"`;

    try {
      // Use thinkingConfig nested inside generationConfig for Gemini 3 Flash
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: "application/json",
          thinkingConfig: {
            thinkingLevel: thinkingLevel,
            includeThoughts: true, // Required to get thoughtSignature for thread updates
          },
        } as any,
      });

      const response = result.response;
      const textContent = response.text();

      // Parse JSON response with multiple fallback strategies
      let extraction: ThoughtExtraction;
      try {
        // First, try parsing directly
        extraction = JSON.parse(textContent.trim());
      } catch (parseError) {
        // Try extracting JSON from markdown code blocks (multiple patterns)
        let jsonString: string | null = null;

        // Pattern 1: ```json ... ```
        const jsonCodeBlock = textContent.match(/```json\s*\n?([\s\S]*?)\n?```/i);
        if (jsonCodeBlock) {
          jsonString = jsonCodeBlock[1].trim();
        }

        // Pattern 2: ``` ... ``` (generic code block)
        if (!jsonString) {
          const genericCodeBlock = textContent.match(/```\s*\n?([\s\S]*?)\n?```/);
          if (genericCodeBlock) {
            jsonString = genericCodeBlock[1].trim();
          }
        }

        // Pattern 3: Find JSON object in text (starts with { and ends with })
        if (!jsonString) {
          const jsonObjectMatch = textContent.match(/\{[\s\S]*\}/);
          if (jsonObjectMatch) {
            jsonString = jsonObjectMatch[0].trim();
          }
        }

        if (jsonString) {
          try {
            extraction = JSON.parse(jsonString);
          } catch (jsonError) {
            console.error("JSON parsing failed. Raw response:", textContent);
            console.error("Extracted JSON string:", jsonString);
            throw new Error(
              `Failed to parse extracted JSON: ${jsonError instanceof Error ? jsonError.message : String(jsonError)}. Response: ${textContent.substring(0, 500)}`
            );
          }
        } else {
          console.error("No JSON found in response. Raw response:", textContent);
          throw new Error(
            `Failed to extract JSON from Gemini response. Response: ${textContent.substring(0, 500)}`
          );
        }
      }

      // Extract thought_signature from response metadata
      // With includeThoughts: true, the signature should be available in candidates
      const candidates = result.response.candidates || [];
      const thoughtSignature =
        (candidates[0] as any)?.groundingMetadata?.thoughtSignature ||
        (candidates[0] as any)?.thinkingLog?.thoughtSignature ||
        (response as any).thoughtSignature ||
        this.generateFallbackSignature(text, extraction);

      return {
        extraction,
        thought_signature: thoughtSignature,
      };
    } catch (error) {
      console.error("Gemini API error:", error);
      throw new Error(
        `Failed to analyze thought with Gemini: ${error instanceof Error ? error.message : String(error)}`
      );
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
   * Generate a fallback signature if not provided by API
   */
  private generateFallbackSignature(
    originalText: string,
    extraction: ThoughtExtraction
  ): string {
    const timestamp = Date.now();
    const contentHash = Buffer.from(
      `${originalText}-${extraction.title}-${timestamp}`
    ).toString("base64");
    return `fallback_${contentHash.substring(0, 32)}`;
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
