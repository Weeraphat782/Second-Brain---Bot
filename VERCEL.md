# Deploying AI Second Brain to Vercel

This project is configured to run on Vercel using Serverless Functions for handling Slack events.

## Prerequisites

1. A Vercel account.
2. The GitHub repository connected to Vercel.

## Configuration Steps

1. **Import Project into Vercel**:
   - Go to Vercel Dashboard -> Add New -> Project.
   - Select your GitHub repository (`Second-Brain---Bot`).
   - Framework Preset: **Other** (or leave as default, Vercel detects `package.json`).

2. **Environment Variables**:
   Add the following environment variables in Vercel Project Settings:
   - `SLACK_BOT_TOKEN`: (xoxb-...)
   - `SLACK_APP_TOKEN`: (xapp-...) *Optional for Vercel, but good to keep*
   - `SLACK_SIGNING_SECRET`: (From Slack App Basic Info)
   - `GEMINI_API_KEY`: (Your Google Gemini API Key)
   - `NOTION_TOKEN`: (secret_...)
   - `NOTION_DATABASE_ID`: (Your Database ID)
   - `VERCEL`: `1` (Automatically set by Vercel usually, but ensuring it triggers HTTP mode)

3. **Deploy**:
   - Click **Deploy**.
   - Wait for the deployment to finish.
   - Copy the **Production URL** (e.g., `https://your-project.vercel.app`).

4. **Configure Slack App**:
   - Go to [api.slack.com/apps](https://api.slack.com/apps).
   - Select your app.
   - **Interactivity & Shortcuts**:
     - Turn On.
     - Request URL: `https://your-project.vercel.app/api/events`
     - Save Changes.
   - **Event Subscriptions**:
     - Turn On.
     - Request URL: `https://your-project.vercel.app/api/events`
     - Wait for "Verified" status.
     - Save Changes.

## Troubleshooting

- **500 Error**: Check Vercel Logs. Ensure all Environment Variables are set.
- **Url Verification Failed**: Ensure `SLACK_SIGNING_SECRET` is correct.
