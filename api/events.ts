import type { VercelRequest, VercelResponse } from '@vercel/node';
import { slackService } from '../src/services/slack.js';
import '../src/index.js'; // Ensure app is initialized

// Disable Vercel's default body parsing to let Bolt handle it if needed
// However, Bolt usually expects parsed body for processEvent if passed directly?
// actually receiver.requestListener expects raw request.
// But we are using processEvent.
// Let's stick to the method we added in SlackService.

export const config = {
    api: {
        bodyParser: false, // We need raw body for signature verification
    },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        // We need to handle the request using our service
        // Note: Since we disabled bodyParser, we might need to buffer the stream
        // check how Bolt's receiver expects it. 
        // If we use receiver.requestListener, it handles it.

        // Let's rely on slackService.handleRequest logic which uses processEvent
        // But processEvent expects a parsed body? 
        // Actually, HTTPReceiver default requestListener does parsing.

        // Let's change approach: Use receiver.requestListener directly if possible.
        // Accessing private receiver from outside is hard.

        // Changing approach for api/events.ts:
        // Read the body manually? No, Bolt verification needs raw body.

        // Let's proxy to the requestListener.
        const receiver = (slackService.getApp() as any).receiver;

        // receiver.requestListener(req, res);
        // But req/res types might mismatch with Node's http types?
        // VercelRequest extends http.IncomingMessage, so it should be fine.

        receiver.requestListener(req, res);

    } catch (error) {
        console.error('Error handling Vercel request:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}
