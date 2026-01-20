import type { VercelRequest, VercelResponse } from '@vercel/node';
import { slackService } from '../src/services/slack.js';
import { initApp } from '../src/index.js';

let initialized = false;

/**
 * Vercel Serverless Function to handle Slack Events
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    // Handle Slack URL Verification Challenge
    if (req.body && req.body.type === 'url_verification') {
        return res.status(200).json({ challenge: req.body.challenge });
    }

    try {
        // Ensure app/listeners are initialized exactly once per instance
        if (!initialized) {
            console.log("DEBUG: Initialization starting in handler...");
            await initApp();
            initialized = true;
            console.log("DEBUG: Initialization complete in handler.");
        }

        const app = slackService.getApp();
        const receiver = (app as any).receiver;

        console.log(`DEBUG: Processing event: ${req.body.event?.type || req.body.type}`);

        // Bolt's processEvent is used to handle the pre-parsed Vercel request body.
        // We await this to ensure the handler work finishes before Vercel terminates.
        await receiver.processEvent({
            body: req.body,
            headers: req.headers,
            ack: async (response: any) => {
                if (!res.writableEnded) {
                    res.status(200).send(response || '');
                }
            },
        });

        console.log("DEBUG: Event processing finished successfully.");
    } catch (error) {
        console.error('Error in Slack Event Handler:', error);
        if (!res.writableEnded) {
            res.status(500).send('Internal Server Error');
        }
    }
}
