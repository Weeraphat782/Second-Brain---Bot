# AI Second Brain

A Node.js/TypeScript backend that captures thoughts from Slack, processes them using Gemini 3 Flash, and stores them in Notion with daily briefings and thread-based updates.

## Setup

1. Copy `.env.example` to `.env` and fill in your credentials
2. Install dependencies: `npm install`
3. Build: `npm run build`
4. Run: `npm start`

For development: `npm run dev`

## Features

- Intelligent capture from Slack DMs/@mentions
- Daily proactive briefings (08:00 AM, 09:00 PM)
- Thread-based contextual updates
- Streaming AI responses in Slack
