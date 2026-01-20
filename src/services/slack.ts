import { App, LogLevel } from "@slack/bolt";
import { getEnv } from "../config/env.js";


export class SlackService {
  private app: App;

  constructor() {
    const env = getEnv();

    this.app = new App({
      token: env.SLACK_BOT_TOKEN,
      appToken: env.SLACK_APP_TOKEN,
      socketMode: true,
      logLevel: LogLevel.INFO,
      signingSecret: env.SLACK_SIGNING_SECRET,
    });
  }

  getApp(): App {
    return this.app;
  }

  /**
   * Send a message to a channel or user
   */
  async sendMessage(
    channel: string,
    text: string,
    threadTS?: string
  ): Promise<string> {
    try {
      const result = await this.app.client.chat.postMessage({
        channel,
        text,
        thread_ts: threadTS,
      });

      return result.ts || "";
    } catch (error) {
      console.error("Failed to send Slack message:", error);
      throw new Error(
        `Slack message failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Start a streaming response in Slack
   * Note: This uses the new chat.startStream API when available
   */
  async startStreamingResponse(
    channel: string,
    initialText: string = "Processing..."
  ): Promise<{ streamId?: string; ts: string }> {
    try {
      // First, send an initial message
      const result = await this.app.client.chat.postMessage({
        channel,
        text: initialText,
      });

      const ts = result.ts || "";

      // Check if streaming API is available
      // Note: chat.startStream may not be available in all Slack workspaces
      // For now, return the message timestamp for progressive updates
      return { ts };
    } catch (error) {
      console.error("Failed to start streaming response:", error);
      throw new Error(
        `Slack streaming failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Update a message with new content (simulates streaming)
   */
  async updateMessage(
    channel: string,
    ts: string,
    text: string
  ): Promise<void> {
    try {
      await this.app.client.chat.update({
        channel,
        ts,
        text,
      });
    } catch (error) {
      console.error("Failed to update Slack message:", error);
      // Non-fatal - continue execution
    }
  }

  /**
   * Send a message with action buttons
   */
  async sendMessageWithButtons(
    channel: string,
    text: string,
    buttons: Array<{ text: string; value: string; actionId: string }>
  ): Promise<string> {
    try {
      const blocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text,
          },
        },
        {
          type: "actions",
          elements: buttons.map((btn) => ({
            type: "button",
            text: {
              type: "plain_text",
              text: btn.text,
            },
            value: btn.value,
            action_id: btn.actionId,
          })),
        },
      ];

      const result = await this.app.client.chat.postMessage({
        channel,
        text,
        blocks: blocks as any,
      });

      return result.ts || "";
    } catch (error) {
      console.error("Failed to send message with buttons:", error);
      throw new Error(
        `Slack button message failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Send a notification with a Notion page link
   */
  async sendNotionLink(
    channel: string,
    threadTS: string,
    pageUrl: string,
    title: string
  ): Promise<void> {
    const message = `✅ Thought captured! View in Notion: <${pageUrl}|${title}>`;
    await this.sendMessage(channel, message, threadTS);
  }

  /**
   * Start the Slack app (connect to Socket Mode)
   */
  async start(port?: number): Promise<void> {
    try {
      await this.app.start(port || 3000);
      console.log("⚡️ Slack app is running!");
    } catch (error) {
      console.error("Failed to start Slack app:", error);
      throw error;
    }
  }

  /**
   * Stop the Slack app
   */
  async stop(): Promise<void> {
    try {
      await this.app.stop();
      console.log("Slack app stopped");
    } catch (error) {
      console.error("Error stopping Slack app:", error);
    }
  }
}

export const slackService = new SlackService();
