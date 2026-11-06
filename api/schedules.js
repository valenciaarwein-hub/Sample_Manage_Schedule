// api/schedules.js
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

const KEY = 'schedule-manager:data';

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    try {
        if (req.method === 'GET') {
            const data = (await redis.get(KEY)) || { schedules: {}, trash: [] };
            return res.status(200).json(data);
        }

        if (req.method === 'PUT') {
            const { schedules, trash } = req.body || {};
            if (typeof schedules !== 'object' || schedules === null || !Array.isArray(trash)) {
                return res.status(400).json({ error: 'Invalid payload' });
            }
            await redis.set(KEY, { schedules, trash });
            return res.status(200).json({ ok: true });
        }

        if (req.method === 'DELETE') {
            await redis.del(KEY);
            return res.status(200).json({ ok: true });
        }

        res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('Redis error:', err);
        return res.status(500).json({ error: 'Database error' });
    }
}
