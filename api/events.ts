import type { VercelRequest, VercelResponse } from '@vercel/node';
import { slackService } from '../src/services/slack.js';
import { initApp } from '../src/index.js';

// Disable body parsing so Bolt can handle the raw stream (needed for signature verification)
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

    try {
        if (!initialized) {
            console.log("DEBUG: Initializing App in Vercel handler...");
            await initApp();
            initialized = true;
        }

        const app = slackService.getApp();

        // Use Bolt's requestListener directly with the raw stream
        // This handles URL verification challenge and signature verification
        console.log(`DEBUG: Delegating ${req.method} request to Bolt...`);

        const receiver = (app as any).receiver;
        if (receiver && typeof receiver.requestListener === 'function') {
            return receiver.requestListener(req, res);
        } else {
            console.error("DEBUG: requestListener not found on receiver");
            res.status(500).send("Internal Server Error: Receiver mismatch");
        }
    } catch (error) {
        console.error('Error in Vercel Slack Handler:', error);
        if (!res.writableEnded) {
            res.status(500).send('Internal Server Error');
        }
    }
}
