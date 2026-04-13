type RequestLike = {
  body?: { increment?: unknown };
  method?: string;
  query: { slug?: string[] | string };
};

type ResponseLike = {
  status: (code: number) => ResponseLike;
  json: (body: Record<string, unknown>) => void;
};

type HitStats = {
  count: number;
  globalTotal: number;
  visitorCount: number;
  dayKey: string;
  storage: 'supabase' | 'memory';
};

type MemoryStore = {
  dayKey: string;
  total: number;
  visitors: Set<string>;
  userCounts: Map<string, number>;
};

const globalStore = globalThis as typeof globalThis & {
  __moktakHitStore?: MemoryStore;
};

function getKoreaDayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function toSafeInteger(value: unknown, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.floor(parsed));
}

function sendJson(res: ResponseLike, status: number, body: Record<string, unknown>) {
  res.status(status).json(body);
}

function getMemoryStore() {
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

function hasSupabaseConfig() {
  return Boolean(process.env.MOKTAK_SUPABASE_URL && process.env.MOKTAK_SUPABASE_SERVICE_ROLE_KEY);
}

function getSupabaseHeaders(extraHeaders?: Record<string, string>) {
  const serviceRoleKey = process.env.MOKTAK_SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error('Missing MOKTAK_SUPABASE_SERVICE_ROLE_KEY');
  }

  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
}

async function supabaseFetch(path: string, init?: RequestInit) {
  const supabaseUrl = process.env.MOKTAK_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('Missing MOKTAK_SUPABASE_URL');
  }

  const response = await fetch(`${supabaseUrl}/rest/v1${path}`, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase request failed: ${response.status} ${text}`);
  }

  return response;
}

async function ensureSupabaseVisitor(userId: string, dayKey: string) {
  await supabaseFetch('/daily_visitors?on_conflict=day_key,user_id', {
    method: 'POST',
    headers: getSupabaseHeaders({
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    }),
    body: JSON.stringify([
      {
        day_key: dayKey,
        user_id: userId,
        hit_count: 0,
      },
    ]),
  });
}

async function fetchSupabaseTotals(dayKey: string) {
  const [statsResponse, visitorsResponse] = await Promise.all([
    supabaseFetch(`/daily_stats?select=total_hits&day_key=eq.${encodeURIComponent(dayKey)}`, {
      method: 'GET',
      headers: getSupabaseHeaders(),
    }),
    supabaseFetch(`/daily_visitors?select=user_id&day_key=eq.${encodeURIComponent(dayKey)}`, {
      method: 'HEAD',
      headers: getSupabaseHeaders({
        Prefer: 'count=exact',
      }),
    }),
  ]);

  const statsRows = (await statsResponse.json()) as Array<{ total_hits?: unknown }>;
  const contentRange = visitorsResponse.headers.get('content-range') || '0-0/0';
  const visitorCount = contentRange.split('/')[1] || '0';

  return {
    globalTotal: toSafeInteger(statsRows[0]?.total_hits),
    visitorCount: toSafeInteger(visitorCount),
  };
}

async function getSupabaseStats(userId: string): Promise<HitStats> {
  const dayKey = getKoreaDayKey();

  await ensureSupabaseVisitor(userId, dayKey);

  const [userResponse, totals] = await Promise.all([
    supabaseFetch(
      `/daily_visitors?select=hit_count&day_key=eq.${encodeURIComponent(dayKey)}&user_id=eq.${encodeURIComponent(userId)}`,
      {
        method: 'GET',
        headers: getSupabaseHeaders(),
      },
    ),
    fetchSupabaseTotals(dayKey),
  ]);

  const userRows = (await userResponse.json()) as Array<{ hit_count?: unknown }>;

  return {
    count: toSafeInteger(userRows[0]?.hit_count),
    globalTotal: totals.globalTotal,
    visitorCount: totals.visitorCount,
    dayKey,
    storage: 'supabase',
  };
}

async function incrementSupabaseStats(userId: string, increment: number): Promise<HitStats> {
  const dayKey = getKoreaDayKey();
  const response = await supabaseFetch('/rpc/increment_moktak_hit', {
    method: 'POST',
    headers: getSupabaseHeaders(),
    body: JSON.stringify({
      p_day_key: dayKey,
      p_user_id: userId,
      p_increment: increment,
    }),
  });

  const rows = (await response.json()) as Array<{
    count?: unknown;
    global_total?: unknown;
    visitor_count?: unknown;
  }>;

  const row = rows[0] || {};

  return {
    count: toSafeInteger(row.count),
    globalTotal: toSafeInteger(row.global_total),
    visitorCount: toSafeInteger(row.visitor_count),
    dayKey,
    storage: 'supabase',
  };
}

function getMemoryStats(userId: string): HitStats {
  const store = getMemoryStore();
  store.visitors.add(userId);

  return {
    count: store.userCounts.get(userId) || 0,
    globalTotal: store.total,
    visitorCount: store.visitors.size,
    dayKey: store.dayKey,
    storage: 'memory',
  };
}

function incrementMemoryStats(userId: string, increment: number): HitStats {
  const store = getMemoryStore();
  store.visitors.add(userId);

  const nextCount = (store.userCounts.get(userId) || 0) + increment;
  store.userCounts.set(userId, nextCount);
  store.total += increment;

  return {
    count: nextCount,
    globalTotal: store.total,
    visitorCount: store.visitors.size,
    dayKey: store.dayKey,
    storage: 'memory',
  };
}

async function readStats(userId: string) {
  if (hasSupabaseConfig()) {
    return getSupabaseStats(userId);
  }

  return getMemoryStats(userId);
}

async function writeStats(userId: string, increment: number) {
  if (hasSupabaseConfig()) {
    return incrementSupabaseStats(userId, increment);
  }

  return incrementMemoryStats(userId, increment);
}

async function readTotals() {
  const dayKey = getKoreaDayKey();

  if (hasSupabaseConfig()) {
    const totals = await fetchSupabaseTotals(dayKey);
    return {
      count: 0,
      globalTotal: totals.globalTotal,
      visitorCount: totals.visitorCount,
      dayKey,
      storage: 'supabase' as const,
    };
  }

  const store = getMemoryStore();
  return {
    count: 0,
    globalTotal: store.total,
    visitorCount: store.visitors.size,
    dayKey: store.dayKey,
    storage: 'memory' as const,
  };
}

export default async function handler(req: RequestLike, res: ResponseLike) {
  const slug = Array.isArray(req.query.slug) ? req.query.slug : [req.query.slug].filter(Boolean);

  if (req.method === 'GET' && slug.length === 1 && slug[0] === 'total') {
    try {
      const stats = await readTotals();
      return sendJson(res, 200, {
        total: stats.globalTotal,
        visitors: stats.visitorCount,
        dayKey: stats.dayKey,
        storage: stats.storage,
      });
    } catch (error) {
      console.error('Failed to read totals:', error);
      return sendJson(res, 500, { error: 'Failed to read totals' });
    }
  }

  if (slug.length !== 1) {
    return sendJson(res, 404, { error: 'Not found' });
  }

  const userId = String(slug[0] || '').trim();
  if (!userId) {
    return sendJson(res, 400, { error: 'Missing userId' });
  }

  if (req.method === 'GET') {
    try {
      const stats = await readStats(userId);
      return sendJson(res, 200, {
        userId,
        count: stats.count,
        globalTotal: stats.globalTotal,
        visitorCount: stats.visitorCount,
        dayKey: stats.dayKey,
        storage: stats.storage,
      });
    } catch (error) {
      console.error('Failed to read user stats:', error);
      return sendJson(res, 500, { error: 'Failed to read user stats' });
    }
  }

  if (req.method === 'POST') {
    try {
      const increment = toSafeInteger(req.body?.increment, 1) || 1;
      const stats = await writeStats(userId, increment);
      return sendJson(res, 200, {
        success: true,
        currentCount: stats.count,
        globalTotal: stats.globalTotal,
        visitorCount: stats.visitorCount,
        dayKey: stats.dayKey,
        storage: stats.storage,
      });
    } catch (error) {
      console.error('Failed to write user stats:', error);
      return sendJson(res, 500, { error: 'Failed to write user stats' });
    }
  }

  return sendJson(res, 405, { error: 'Method not allowed' });
}
