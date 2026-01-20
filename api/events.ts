import type { VercelRequest, VercelResponse } from '@vercel/node';
import { slackService } from '../src/services/slack.js';

// IMPORTANT: Import index.js to register events
import '../src/index.js';

/**
 * Vercel Serverless Function to handle Slack Events
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    // Handle URL Verification
    if (req.body && req.body.type === 'url_verification') {
        return res.status(200).json({ challenge: req.body.challenge });
    }

    try {
        const app = slackService.getApp();
        const receiver = (app as any).receiver;

        // In Vercel, we use the receiver's requestListener directly.
        // However, Bolt's HTTPReceiver expects the path to match.
        // We already updated SlackService to set endpoints to /api/events.

        // We proxy the request to Bolt's internal request listener
        const requestListener = receiver.requestListener || receiver.requestHandler;

        if (requestListener) {
            return requestListener(req, res);
        }

        // Fallback if requestListener is not available
        await receiver.processEvent({
            body: req.body,
            headers: req.headers,
            ack: async (response: any) => {
                if (!res.writableEnded) {
                    res.status(200).send(response || '');
                }
            },
        });
    } catch (error) {
        console.error('Error in Slack Event Handler:', error);
        if (!res.writableEnded) {
            res.status(500).send('Internal Server Error');
        }
    }
}
