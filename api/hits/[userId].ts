import { makeErrorBody, readUserStats, writeUserStats } from './_lib';

type RequestLike = {
  body?: { increment?: unknown };
  method?: string;
  query: { userId?: string | string[] };
};

type ResponseLike = {
  status: (code: number) => ResponseLike;
  json: (body: Record<string, unknown>) => void;
};

export default async function handler(req: RequestLike, res: ResponseLike) {
  const rawUserId = Array.isArray(req.query.userId) ? req.query.userId[0] : req.query.userId;
  const userId = String(rawUserId || '').trim();

  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  if (req.method === 'GET') {
    try {
      const stats = await readUserStats(userId);
      return res.status(200).json({
        userId,
        count: stats.count,
        globalTotal: stats.globalTotal,
        visitorCount: stats.visitorCount,
        dayKey: stats.dayKey,
        storage: stats.storage,
      });
    } catch (error) {
      console.error('Failed to read user stats:', error);
      return res.status(500).json(makeErrorBody(error, 'Failed to read user stats'));
    }
  }

  if (req.method === 'POST') {
    try {
      const increment =
        typeof req.body?.increment === 'number' ? req.body.increment : Number(req.body?.increment ?? 1);
      const stats = await writeUserStats(userId, increment);
      return res.status(200).json({
        success: true,
        currentCount: stats.count,
        globalTotal: stats.globalTotal,
        visitorCount: stats.visitorCount,
        dayKey: stats.dayKey,
        storage: stats.storage,
      });
    } catch (error) {
      console.error('Failed to write user stats:', error);
      return res.status(500).json(makeErrorBody(error, 'Failed to write user stats'));
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
