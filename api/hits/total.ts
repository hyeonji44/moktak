import { makeErrorBody, readTotals } from './_lib';

type ResponseLike = {
  status: (code: number) => ResponseLike;
  json: (body: Record<string, unknown>) => void;
};

export default async function handler(_req: unknown, res: ResponseLike) {
  try {
    const stats = await readTotals();
    return res.status(200).json({
      total: stats.globalTotal,
      visitors: stats.visitorCount,
      dayKey: stats.dayKey,
      storage: stats.storage,
    });
  } catch (error) {
    console.error('Failed to read totals:', error);
    return res.status(500).json(makeErrorBody(error, 'Failed to read totals'));
  }
}
