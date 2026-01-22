import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sendMorningBriefing } from '../../src/handlers/briefings.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Only allow Vercel Cron to trigger this
    const authHeader = req.headers['authorization'];
    if (process.env.NODE_ENV === 'production' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).end('Unauthorized');
    }

    console.log('DEBUG: Triggering Midday Briefing via Cron...');
    try {
        // Reusing Morning Briefing logic for Midday status update
        await sendMorningBriefing();
        return res.status(200).json({ success: true, message: 'Midday briefing sent' });
    } catch (error) {
        console.error('Midday briefing cron error:', error);
        return res.status(500).json({ success: false, error: String(error) });
    }
}
