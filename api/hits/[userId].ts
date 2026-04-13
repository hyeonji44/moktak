type RequestLike = {
  method?: string;
  query: { userId?: string | string[]; increment?: string | string[] };
};

type ResponseLike = {
  status: (code: number) => ResponseLike;
  json: (body: Record<string, unknown>) => void;
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

function getSupabaseConfig() {
  const rawUrl = process.env.MOKTAK_SUPABASE_URL || process.env.SUPABASE_URL;
  const rawKey = process.env.MOKTAK_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  return {
    url: rawUrl?.trim().replace(/^['"]|['"]$/g, ''),
    key: rawKey?.trim().replace(/^['"]|['"]$/g, ''),
  };
}

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
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

function getMemoryStore() {
  const dayKey = getKoreaDayKey();

  if (!globalStore.__moktakHitStore || globalStore.__moktakHitStore.dayKey !== dayKey) {
    globalStore.__moktakHitStore = {
      dayKey,
      total: 0,
      visitors: new Set(),
      userCounts: new Map(),
    };
  }

  return globalStore.__moktakHitStore;
}

async function supabaseRequest(path: string, init?: RequestInit) {
  const { url, key } = getSupabaseConfig();

  if (!url || !key) {
    throw new Error('Missing Supabase config');
  }

  const response = await fetch(`${url}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase request failed: ${response.status} ${await response.text()}`);
  }

  return response;
}

async function ensureSupabaseVisitor(userId: string, dayKey: string) {
  await supabaseRequest('daily_visitors?on_conflict=day_key,user_id', {
    method: 'POST',
    headers: {
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify([{ day_key: dayKey, user_id: userId, hit_count: 0 }]),
  });
}

async function readSupabaseStats(userId: string) {
  const dayKey = getKoreaDayKey();
  await ensureSupabaseVisitor(userId, dayKey);

  const [userRows, statsRows, visitorRows] = (await Promise.all([
    supabaseRequest(
      `daily_visitors?select=hit_count&day_key=eq.${encodeURIComponent(dayKey)}&user_id=eq.${encodeURIComponent(userId)}`,
    ).then(res => res.json()),
    supabaseRequest(`daily_stats?select=total_hits&day_key=eq.${encodeURIComponent(dayKey)}`).then(res => res.json()),
    supabaseRequest(`daily_visitors?select=user_id&day_key=eq.${encodeURIComponent(dayKey)}`).then(res => res.json()),
  ])) as [
    Array<{ hit_count?: unknown }>,
    Array<{ total_hits?: unknown }>,
    Array<{ user_id?: unknown }>,
  ];

  return {
    count: toSafeInteger(userRows[0]?.hit_count),
    globalTotal: toSafeInteger(statsRows[0]?.total_hits),
    visitorCount: visitorRows.length,
    dayKey,
    storage: 'supabase' as const,
  };
}

async function writeSupabaseStats(userId: string, increment: number) {
  const dayKey = getKoreaDayKey();
  const response = await supabaseRequest('rpc/increment_moktak_hit', {
    method: 'POST',
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
    storage: 'supabase' as const,
  };
}

export default async function handler(req: RequestLike, res: ResponseLike) {
  try {
    const rawUserId = Array.isArray(req.query.userId) ? req.query.userId[0] : req.query.userId;
    const userId = String(rawUserId || '').trim();

    if (!userId) {
      return res.status(400).json({ error: 'Missing userId' });
    }

    const rawIncrement = Array.isArray(req.query.increment) ? req.query.increment[0] : req.query.increment;
    const increment = toSafeInteger(rawIncrement, 0);
    const { url, key } = getSupabaseConfig();

    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    if (url && key) {
      const stats =
        increment > 0 ? await writeSupabaseStats(userId, increment) : await readSupabaseStats(userId);

      return res.status(200).json({
        userId,
        count: stats.count,
        currentCount: stats.count,
        globalTotal: stats.globalTotal,
        visitorCount: stats.visitorCount,
        dayKey: stats.dayKey,
        storage: stats.storage,
      });
    }

    const store = getMemoryStore();
    store.visitors.add(userId);

    if (increment > 0) {
      const nextCount = (store.userCounts.get(userId) || 0) + increment;
      store.userCounts.set(userId, nextCount);
      store.total += increment;

      return res.status(200).json({
        userId,
        count: nextCount,
        currentCount: nextCount,
        globalTotal: store.total,
        visitorCount: store.visitors.size,
        dayKey: store.dayKey,
        storage: 'memory',
      });
    }

    return res.status(200).json({
      userId,
      count: store.userCounts.get(userId) || 0,
      globalTotal: store.total,
      visitorCount: store.visitors.size,
      dayKey: store.dayKey,
      storage: 'memory',
    });
  } catch (error) {
    console.error('Failed to handle user stats:', error);
    return res.status(500).json({
      error: 'Failed to handle user stats',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
