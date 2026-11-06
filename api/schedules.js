// api/schedules.js
import { kv } from '@vercel/kv';

const KEY = 'schedule-manager:data';

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    try {
        if (req.method === 'GET') {
            const data = (await kv.get(KEY)) || { schedules: {}, trash: [] };
            return res.status(200).json(data);
        }

        if (req.method === 'PUT') {
            const { schedules, trash } = req.body || {};
            if (typeof schedules !== 'object' || schedules === null || !Array.isArray(trash)) {
                return res.status(400).json({ error: 'Invalid payload' });
            }
            await kv.set(KEY, { schedules, trash });
            return res.status(200).json({ ok: true });
        }

        if (req.method === 'DELETE') {
            await kv.del(KEY);
            return res.status(200).json({ ok: true });
        }

        res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('KV error:', err);
        return res.status(500).json({ error: 'Database error' });
    }
}
