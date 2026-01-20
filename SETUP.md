# Setup Guide

## Prerequisites

1. **Node.js** 20+ and npm
2. **Slack App** with Socket Mode enabled
3. **Google AI Studio** API key (for Gemini 3 Flash)
4. **Notion Integration** with database access

## Environment Variables

Create a `.env` file in the root directory:

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_SIGNING_SECRET=your-signing-secret (optional for Socket Mode)
GEMINI_API_KEY=your-gemini-api-key
NOTION_TOKEN=secret-your-notion-token
NOTION_DATABASE_ID=your-database-id
BRIEFING_CHANNEL_ID=C1234567890 (Slack channel for briefings)
TIMEZONE=Asia/Bangkok (or your timezone)
```

## Notion Database Schema

Your Notion database must have the following properties:

| Property Name | Type | Options/Values |
|--------------|------|----------------|
| Title | Title | - |
| Summary | Rich Text | - |
| Category | Select | Work, Personal, Idea, Health |
| Priority | Select | P1, P2, P3 |
| Due Date | Date | - |
| Status | Status | Todo, In Progress, Done |
| ThoughtSignature | Rich Text | (Hidden field for internal use) |
| SlackThreadTS | Rich Text | (Hidden field for thread tracking) |

**Important**: The code uses Notion API version `2025-09-03`. Ensure your Notion database has at least one data source. The code will automatically discover the `data_source_id` on startup.

## Installation

```bash
npm install
npm run build
```

## Running

Development mode (with hot reload):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## API Compatibility Notes

1. **Notion API 2025-09-03**: The code uses the new data source discovery flow. If you encounter issues, ensure you're using a compatible Notion SDK version. The implementation includes fallback methods for compatibility.

2. **Gemini 3 Flash**: The `thinking_level` parameter may need adjustment based on the latest SDK. If you see errors, check the Google Generative AI SDK documentation for the correct parameter format.

3. **Slack Streaming**: The streaming implementation uses `chat.startStream` when available. If your workspace doesn't support it, the code falls back to standard message updates.

## Testing

1. Send a DM to your Slack bot or mention it in a channel
2. Check Notion - a new page should be created
3. Reply in the thread to update the task
4. Wait for daily briefings at 08:00 AM and 09:00 PM

## Troubleshooting

- **Notion errors**: Check that your database has the required properties and your integration has access
- **Gemini errors**: Verify your API key is valid and has access to `gemini-3-flash-preview`
- **Slack errors**: Ensure Socket Mode is enabled and tokens are correct
- **Scheduler issues**: Verify your timezone setting matches your local time
