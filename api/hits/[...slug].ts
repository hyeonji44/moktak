type HitStore = {
  dayKey: string;
  total: number;
  visitors: Set<string>;
  userCounts: Map<string, number>;
};

const globalStore = globalThis as typeof globalThis & {
  __moktakHitStore?: HitStore;
};

function getKoreaDayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function getStore() {
  const today = getKoreaDayKey();

  if (!globalStore.__moktakHitStore || globalStore.__moktakHitStore.dayKey !== today) {
    globalStore.__moktakHitStore = {
      dayKey: today,
      total: 0,
      visitors: new Set(),
      userCounts: new Map(),
    };
  }

  return globalStore.__moktakHitStore;
}

function sendJson(res: any, status: number, body: Record<string, unknown>) {
  res.status(status).json(body);
}

export default function handler(req: any, res: any) {
  const slug = Array.isArray(req.query.slug) ? req.query.slug : [];
  const store = getStore();

  if (req.method === 'GET' && slug.length === 1 && slug[0] === 'total') {
    return sendJson(res, 200, {
      total: store.total,
      visitors: store.visitors.size,
      dayKey: store.dayKey,
    });
  }

  if (slug.length !== 1) {
    return sendJson(res, 404, { error: 'Not found' });
  }

  const userId = String(slug[0] || '').trim();
  if (!userId) {
    return sendJson(res, 400, { error: 'Missing userId' });
  }

  store.visitors.add(userId);

  if (req.method === 'GET') {
    return sendJson(res, 200, {
      userId,
      count: store.userCounts.get(userId) || 0,
      globalTotal: store.total,
      visitorCount: store.visitors.size,
      dayKey: store.dayKey,
    });
  }

  if (req.method === 'POST') {
    const rawIncrement = Number(req.body?.increment ?? 1);
    const increment = Number.isFinite(rawIncrement) ? Math.max(0, Math.floor(rawIncrement)) : 1;
    const nextCount = (store.userCounts.get(userId) || 0) + increment;

    store.userCounts.set(userId, nextCount);
    store.total += increment;

    return sendJson(res, 200, {
      success: true,
      currentCount: nextCount,
      globalTotal: store.total,
      visitorCount: store.visitors.size,
      dayKey: store.dayKey,
    });
  }

  return sendJson(res, 405, { error: 'Method not allowed' });
}
