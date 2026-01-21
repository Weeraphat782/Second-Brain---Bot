// Gemini 3 Flash response types
export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

export type TaskCategory = "Work" | "Personal" | "Idea" | "Health";
export type TaskPriority = "P1" | "P2" | "P3";

export interface ThoughtExtraction {
  title: string;
  clean_summary: string;
  category: TaskCategory;
  priority: TaskPriority;
  due_date: string; // ISO 8601 format
  assignee: string | null;
  intent: "new_task" | "update_task" | "query" | "delete_task"; // Detect if creating, updating, querying, or deleting
  target_task_title: string | null; // If intent is update or delete, this is the fuzzy title match
  search_query: string | null; // If intent is query, this is the search term
}

export interface GeminiResponse {
  extractions: ThoughtExtraction[];
  thought_signature: string;
}

export interface GeminiUpdateResult {
  action: "completed" | "in_progress" | "detail" | "rescheduled" | "unchanged" | "deleted";
  updates?: {
    status?: "Done" | "In Progress";
    note?: string;
    due_date?: string;
  };
  thought_signature?: string; // Updated signature if provided
}

// Notion types
export interface NotionTask {
  pageId: string;
  title: string;
  summary: string;
  category: TaskCategory;
  priority: TaskPriority;
  dueDate: string | null;
  status: string;
  assignee: string | null;
  thoughtSignature: string | null;
  slackThreadTS: string | null;
}

export interface NotionPageProperties {
  Title: {
    title: Array<{ text: { content: string } }>;
  };
  Summary: {
    rich_text: Array<{ text: { content: string } }>;
  };
  Category: {
    select: { name: TaskCategory } | null;
  };
  Priority: {
    select: { name: TaskPriority } | null;
  };
  "Due Date": {
    date: { start: string } | null;
  };
  Status: {
    status: { name: string } | null;
  };
  "Assign to": {
    rich_text: Array<{ text: { content: string } }>;
  };
  ThoughtSignature: {
    rich_text: Array<{ text: { content: string } }>;
  };
  SlackThreadTS: {
    rich_text: Array<{ text: { content: string } }>;
  };
}

// Slack types
export interface SlackMessageEvent {
  channel: string;
  user: string;
  text: string;
  ts: string;
  thread_ts?: string;
  event_ts: string;
}

export interface ThreadMapping {
  threadTS: string;
  notionPageId: string;
  thoughtSignature: string;
}

// Briefing types
export interface DailyBriefing {
  focusList: Array<{
    title: string;
    priority: TaskPriority;
    dueDate: string;
    summary: string;
  }>;
  summary: string;
}

export interface DailyReview {
  tasks: Array<{
    pageId: string;
    title: string;
    category: TaskCategory;
    priority: TaskPriority;
    status: string;
    summary: string;
  }>;
}
