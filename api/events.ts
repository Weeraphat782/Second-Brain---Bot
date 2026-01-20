import type { VercelRequest, VercelResponse } from '@vercel/node';
import { slackService } from '../src/services/slack.js';
import { initApp } from '../src/index.js';

// Disable Vercel's body parser to allow Bolt to check signatures on the raw stream
export const config = {
    api: {
        bodyParser: false,
    },
};

let initialized = false;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    // Ignore Slack Retries to prevent duplicate processing (Serverless)
    if (req.headers['x-slack-retry-num']) {
        console.log(`DEBUG: Ignoring Slack retry #${req.headers['x-slack-retry-num']}`);
        return res.status(200).send();
    }

    try {
        if (!initialized) {
            console.log("DEBUG: Initializing App in Vercel handler...");
            await initApp();
            initialized = true;
        }

        const app = slackService.getApp();

        console.log("DEBUG: Delegating request to Bolt...");

        // Use the official receiver.requestListener (which handles the response)
        // Combined with processBeforeResponse: true in SlackService, 
        // it will now wait for all handlers to finish before sending res.end()
        const receiver = (app as any).receiver;

        // We wrap it in a promise-like way or just ensure we don't return before it's done
        // However, Node's http.RequestListener doesn't return a promise.
        // The safest way on Vercel is to use the processEvent which takes a raw request/response 
        // BUT since we are using Bolt 4.x, let's use the receiver's internal match

        // Actually, receiver's requestListener will call res.end() when done.
        // Vercel keeps the function alive UNTIL res.end() is called.
        // With processBeforeResponse: true, Bolt won't call res.end() until our handlers are done.

        await receiver.requestListener(req, res);

        console.log("DEBUG: Request listener finished execution.");
    } catch (error) {
        console.error('Error in Vercel Slack Handler:', error);
        if (!res.writableEnded) {
            res.status(500).send('Internal Server Error');
        }
    }
}
