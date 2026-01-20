import type { VercelRequest, VercelResponse } from '@vercel/node';

// Handle Slack URL Verification and Events
export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        const body = req.body;

        // Handle Slack URL Verification Challenge
        if (body && body.type === 'url_verification') {
            console.log('Slack URL Verification received');
            res.status(200).json({ challenge: body.challenge });
            return;
        }

        // For actual events, we need to import and initialize the app
        // Lazy load to avoid initialization issues
        const { slackService } = await import('../src/services/slack.js');

        // Initialize event handlers
        await import('../src/index.js');

        // Use Bolt's receiver to handle the event
        const receiver = (slackService.getApp() as any).receiver;

        if (receiver && receiver.requestListener) {
            // Let Bolt handle the request
            receiver.requestListener(req, res);
        } else {
            // Fallback: acknowledge the event
            res.status(200).json({ ok: true });
        }
    } catch (error) {
        console.error('Error handling Vercel request:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}
