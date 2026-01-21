import { Client } from "@notionhq/client";
import { getEnv } from "../config/env.js";
import type {
  ThoughtExtraction,
  NotionTask,
  NotionPageProperties,
} from "../types/index.js";

export class NotionService {
  private client: Client;
  private databaseId: string;
  private dataSourceId: string | null = null;

  constructor() {
    const env = getEnv();
    this.client = new Client({
      auth: env.NOTION_TOKEN,
      notionVersion: "2022-06-28",
    });
    // Extract clean UUID from database ID and format it with dashes
    this.databaseId = this.formatUUID(this.extractDatabaseId(env.NOTION_DATABASE_ID));
  }

  /**
   * Format a hex string into a UUID with dashes (8-4-4-4-12)
   */
  private formatUUID(id: string): string {
    // If already has dashes and correct length (36), return as is
    if (id.includes("-") && id.length === 36) return id;

    // Only proceed if we have exactly 32 hex chars
    if (id.length !== 32) return id;

    return `${id.substring(0, 8)}-${id.substring(8, 12)}-${id.substring(12, 16)}-${id.substring(16, 20)}-${id.substring(20)}`;
  }

  /**
   * Extract clean UUID from database ID string
   * Handles full URLs, UUIDs with query params, or plain UUIDs
   */
  private extractDatabaseId(rawId: string): string {
    // Remove query parameters and fragments
    const withoutQuery = rawId.split('?')[0].split('#')[0];

    // Extract UUID pattern (32 hex characters, with or without dashes)
    // Notion UUIDs are 32 hex chars without dashes when extracted from URLs
    const uuidPattern = /([a-f0-9]{32})/i;
    const match = withoutQuery.match(uuidPattern);

    if (match) {
      return match[1];
    }

    // If no match, try to extract from URL path
    const pathMatch = withoutQuery.match(/[a-f0-9]{32}/i);
    if (pathMatch) {
      return pathMatch[0];
    }

    // If still no match, return cleaned version (remove non-hex chars except dashes)
    const cleaned = withoutQuery.replace(/[^a-f0-9-]/gi, '');
    if (cleaned.length >= 32) {
      return cleaned.substring(0, 32);
    }

    // Fallback: return as-is and let API validate
    console.warn(`Warning: Could not extract clean UUID from database ID: ${rawId}`);
    return rawId;
  }

  /**
   * Discover and cache the data_source_id for the database
   * Falls back to database_id if data source discovery fails
   */
  async discoverDataSource(): Promise<string | null> {
    if (this.dataSourceId) {
      return this.dataSourceId;
    }

    try {
      const database = await this.client.databases.retrieve({
        database_id: this.databaseId,
      });

      // Extract data_sources array from the database object
      // Note: Type definitions may need adjustment based on actual API response
      const dataSources = (database as any).data_sources || [];

      if (dataSources.length > 0) {
        // Use the first data source (or you could select by name)
        this.dataSourceId = dataSources[0].id;
        console.log(`Discovered data source: ${this.dataSourceId}`);
        return this.dataSourceId;
      } else {
        // No data sources found - return null to use database_id fallback
        console.warn(`No data sources found in database ${this.databaseId}. Using database_id directly.`);
        return null;
      }
    } catch (error) {
      // If discovery fails, fall back to using database_id directly
      console.warn("Data source discovery failed, using database_id fallback:", error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  /**
   * Create a Notion page from a thought extraction
   */
  async createPageFromThought(
    extraction: ThoughtExtraction,
    thoughtSignature: string,
    slackThreadTS: string
  ): Promise<{ pageId: string; url: string }> {
    const dataSourceId = await this.discoverDataSource();

    const properties: NotionPageProperties = {
      Title: {
        title: [{ text: { content: extraction.title } }],
      },
      Summary: {
        rich_text: [{ text: { content: extraction.clean_summary } }],
      },
      Category: {
        select: { name: extraction.category },
      },
      Priority: {
        select: { name: extraction.priority },
      },
      "Due Date": extraction.due_date
        ? {
          date: { start: extraction.due_date },
        }
        : { date: null },
      Status: {
        status: { name: "Todo" },
      },
      "Assign to": {
        rich_text: [{ text: { content: extraction.assignee || "" } }],
      },
      ThoughtSignature: {
        rich_text: [{ text: { content: thoughtSignature } }],
      },
      SlackThreadTS: {
        rich_text: [{ text: { content: slackThreadTS } }],
      },
    };

    try {
      // Use data_source_id if available, otherwise fall back to database_id
      const page = await this.client.pages.create({
        parent: dataSourceId
          ? {
            type: "data_source_id",
            data_source_id: dataSourceId,
          } as any
          : {
            type: "database_id",
            database_id: this.databaseId,
          },
        properties: properties as any,
      });

      const pageId = page.id;
      const url = this.getPageUrl(pageId);

      return { pageId, url };
    } catch (error) {
      console.error("Failed to create Notion page:", error);
      throw new Error(
        `Notion page creation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Query tasks due today or earlier that are not completed
   */
  async queryDueTasks(): Promise<NotionTask[]> {
    const dataSourceId = await this.discoverDataSource();
    const today = new Date().toISOString().split("T")[0];

    // If no data source, use fallback method
    if (!dataSourceId) {
      return this.queryDueTasksFallback(today);
    }

    try {
      // Use data source query endpoint
      const response = await this.client.request({
        method: "post",
        path: `data_sources/${dataSourceId}/query`,
        body: {
          filter: {
            and: [
              {
                property: "Due Date",
                date: {
                  on_or_before: today,
                },
              },
              {
                property: "Status",
                status: {
                  does_not_equal: "Done",
                },
              },
            ],
          },
          sorts: [
            {
              property: "Priority",
              direction: "ascending",
            },
            {
              property: "Due Date",
              direction: "ascending",
            },
          ],
        },
      }) as any;

      const pages = response.results || [];
      return pages.map(this.mapPageToTask);
    } catch (error) {
      console.error("Failed to query due tasks:", error);
      // Fallback to pages.query if data_sources/:id/query doesn't exist
      return this.queryDueTasksFallback(today);
    }
  }

  /**
   * Fallback query method if data source query endpoint is not available
   */
  private async queryDueTasksFallback(today: string): Promise<NotionTask[]> {
    try {
      const response = await this.client.databases.query({
        database_id: this.databaseId,
        filter: {
          and: [
            {
              property: "Due Date",
              date: {
                on_or_before: today,
              },
            },
            {
              property: "Status",
              status: {
                does_not_equal: "Done",
              },
            },
          ],
        },
        sorts: [
          {
            property: "Priority",
            direction: "ascending",
          },
          {
            property: "Due Date",
            direction: "ascending",
          },
        ],
      });

      return response.results.map(this.mapPageToTask);
    } catch (error) {
      console.error("Fallback query also failed:", error);
      return [];
    }
  }

  /**
   * Query tasks modified or created today
   */
  async queryModifiedToday(): Promise<NotionTask[]> {
    const dataSourceId = await this.discoverDataSource();
    const today = new Date().toISOString().split("T")[0];
    const todayStart = `${today}T00:00:00.000Z`;

    // If no data source, use fallback method
    if (!dataSourceId) {
      return this.queryModifiedTodayFallback(todayStart);
    }

    try {
      const response = await this.client.request({
        method: "post",
        path: `data_sources/${dataSourceId}/query`,
        body: {
          filter: {
            or: [
              {
                property: "Created Time",
                created_time: {
                  on_or_after: todayStart,
                },
              },
              {
                property: "Last Edited Time",
                last_edited_time: {
                  on_or_after: todayStart,
                },
              },
            ],
          },
          sorts: [
            {
              property: "Created Time",
              direction: "descending",
            },
          ],
        },
      }) as any;

      const pages = response.results || [];
      return pages.map(this.mapPageToTask);
    } catch (error) {
      console.error("Failed to query modified tasks:", error);
      return this.queryModifiedTodayFallback(todayStart);
    }
  }

  /**
   * Fallback query for modified tasks
   */
  private async queryModifiedTodayFallback(
    todayStart: string
  ): Promise<NotionTask[]> {
    try {
      const response = await this.client.databases.query({
        database_id: this.databaseId,
        filter: {
          or: [
            {
              property: "Created Time",
              created_time: {
                on_or_after: todayStart,
              },
            },
            {
              property: "Last Edited Time",
              last_edited_time: {
                on_or_after: todayStart,
              },
            },
          ],
        },
        sorts: [
          {
            property: "Created Time",
            direction: "descending",
          },
        ],
      });

      return response.results.map(this.mapPageToTask);
    } catch (error) {
      console.error("Fallback modified query failed:", error);
      return [];
    }
  }

  /**
   * Find a Notion page by Slack thread timestamp
   */
  async findPageByThreadTS(threadTS: string): Promise<NotionTask | null> {
    const dataSourceId = await this.discoverDataSource();

    // If no data source, use fallback method
    if (!dataSourceId) {
      return this.findPageByThreadTSFallback(threadTS);
    }

    try {
      const response = await this.client.request({
        method: "post",
        path: `data_sources/${dataSourceId}/query`,
        body: {
          filter: {
            property: "SlackThreadTS",
            rich_text: {
              equals: threadTS,
            },
          },
        },
      }) as any;

      const pages = response.results || [];
      if (pages.length === 0) {
        return null;
      }

      return this.mapPageToTask(pages[0]);
    } catch (error) {
      console.error("Failed to find page by thread TS:", error);
      // Fallback
      return this.findPageByThreadTSFallback(threadTS);
    }
  }

  /**
   * Find a Notion page by fuzzy title search
   */
  async findPageByTitle(partialTitle: string): Promise<NotionTask | null> {
    const dataSourceId = await this.discoverDataSource();

    // If no data source, use fallback method
    if (!dataSourceId) {
      return this.findPageByTitleFallback(partialTitle);
    }

    try {
      const response = await this.client.request({
        method: "post",
        path: `data_sources/${dataSourceId}/query`,
        body: {
          filter: {
            property: "Title",
            title: {
              contains: partialTitle,
            },
          },
        },
      }) as any;

      const pages = response.results || [];
      if (pages.length === 0) {
        return null;
      }

      // Return the most relevant match (first one)
      return this.mapPageToTask(pages[0]);
    } catch (error) {
      console.error("Failed to find page by title:", error);
      return this.findPageByTitleFallback(partialTitle);
    }
  }

  /**
   * Fallback method to find page by title
   */
  private async findPageByTitleFallback(
    partialTitle: string
  ): Promise<NotionTask | null> {
    try {
      const response = await this.client.databases.query({
        database_id: this.databaseId,
        filter: {
          property: "Title",
          title: {
            contains: partialTitle,
          },
        },
      });

      if (response.results.length === 0) {
        return null;
      }

      return this.mapPageToTask(response.results[0]);
    } catch (error) {
      console.error("Fallback find page by title failed:", error);
      return null;
    }
  }

  /**
   * Search tasks for conversational query (broad search)
   */
  async searchTasks(query: string): Promise<NotionTask[]> {
    console.log(`DEBUG: Searching Notion tasks. Query: "${query}"`);
    try {
      // If query is "all" or empty, return all non-done tasks
      const queryLower = query?.toLowerCase() || "";
      const isBroadSearch = !queryLower || queryLower === "all" || queryLower === "everything" || queryLower === "everyone";

      const filter: any = isBroadSearch
        ? {
          property: "Status",
          status: {
            does_not_equal: "Done"
          }
        }
        : {
          or: [
            {
              property: "Title",
              title: {
                contains: query,
              },
            },
            {
              property: "Assign to",
              rich_text: {
                contains: query
              }
            },
            {
              property: "Category",
              select: {
                equals: query,
              },
            }
          ],
        };

      const response = await this.client.databases.query({
        database_id: this.databaseId,
        filter: filter,
        sorts: [
          {
            property: "Priority",
            direction: "ascending",
          },
          {
            property: "Due Date",
            direction: "ascending",
          },
        ],
        page_size: 15,
      });

      return response.results.map(this.mapPageToTask);
    } catch (error) {
      console.error("Search tasks failed:", error);
      return [];
    }
  }

  /**
   * Fallback method to find page by thread TS
   */
  private async findPageByThreadTSFallback(
    threadTS: string
  ): Promise<NotionTask | null> {
    try {
      const response = await this.client.databases.query({
        database_id: this.databaseId,
        filter: {
          property: "SlackThreadTS",
          rich_text: {
            equals: threadTS,
          },
        },
      });

      if (response.results.length === 0) {
        return null;
      }

      return this.mapPageToTask(response.results[0]);
    } catch (error) {
      console.error("Fallback find page failed:", error);
      return null;
    }
  }

  /**
   * Update a Notion page's status
   */
  async updatePageStatus(pageId: string, status: string): Promise<void> {
    try {
      await this.client.pages.update({
        page_id: pageId,
        properties: {
          Status: {
            status: { name: status },
          },
        } as any,
      });
    } catch (error) {
      console.error("Failed to update page status:", error);
      throw new Error(
        `Status update failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Append a note to a Notion page's Summary
   */
  async appendNote(pageId: string, note: string): Promise<void> {
    try {
      // First, get the current page to read existing summary
      const page = await this.client.pages.retrieve({ page_id: pageId });
      const properties = (page as any).properties || {};
      const currentSummary =
        properties.Summary?.rich_text?.[0]?.text?.content || "";

      const updatedSummary = currentSummary
        ? `${currentSummary}\n\n[Update]: ${note}`
        : note;

      await this.client.pages.update({
        page_id: pageId,
        properties: {
          Summary: {
            rich_text: [{ text: { content: updatedSummary } }],
          },
        } as any,
      });
    } catch (error) {
      console.error("Failed to append note:", error);
      throw new Error(
        `Note append failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Update a page's due date
   */
  async updateDueDate(pageId: string, dueDate: string): Promise<void> {
    try {
      await this.client.pages.update({
        page_id: pageId,
        properties: {
          "Due Date": {
            date: { start: dueDate },
          },
        } as any,
      });
    } catch (error) {
      console.error("Failed to update due date:", error);
      throw new Error(
        `Due date update failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Map a Notion page object to NotionTask
   */
  private mapPageToTask(page: any): NotionTask {
    const props = page.properties || {};

    return {
      pageId: page.id,
      title:
        props.Title?.title?.[0]?.text?.content || "Untitled",
      summary:
        props.Summary?.rich_text?.[0]?.text?.content || "",
      category: props.Category?.select?.name || "Work",
      priority: props.Priority?.select?.name || "P3",
      dueDate: props["Due Date"]?.date?.start || null,
      status: props.Status?.status?.name || "Todo",
      assignee: props["Assign to"]?.rich_text?.[0]?.text?.content || null,
      thoughtSignature:
        props.ThoughtSignature?.rich_text?.[0]?.text?.content || null,
      slackThreadTS:
        props.SlackThreadTS?.rich_text?.[0]?.text?.content || null,
    };
  }

  /**
   * Get the Notion page URL
   */
  private getPageUrl(pageId: string): string {
    return `https://notion.so/${pageId.replace(/-/g, "")}`;
  }

  /**
   * Get page URL by ID (public method)
   */
  getPageUrlById(pageId: string): string {
    return this.getPageUrl(pageId);
  }
}

export const notionService = new NotionService();
