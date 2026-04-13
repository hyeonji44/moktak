type ResponseLike = {
  status: (code: number) => ResponseLike;
  setHeader?: (name: string, value: string) => void;
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

function isProductionRuntime() {
  return process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
}

function getKoreaDayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
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

function toSafeInteger(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

async function supabaseFetch(path: string) {
  const { url, key } = getSupabaseConfig();

  if (!url || !key) {
    throw new Error('Missing Supabase config');
  }

  const response = await fetch(`${url}/rest/v1${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase request failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

export default async function handler(_req: unknown, res: ResponseLike) {
  try {
    res.setHeader?.('Cache-Control', 'no-store, max-age=0');
    const { url, key } = getSupabaseConfig();
    const dayKey = getKoreaDayKey();

    if (url && key) {
      const [statsRows, visitorRows] = (await Promise.all([
        supabaseFetch(`/daily_stats?select=total_hits&day_key=eq.${encodeURIComponent(dayKey)}`),
        supabaseFetch(`/daily_visitors?select=user_id&day_key=eq.${encodeURIComponent(dayKey)}`),
      ])) as [Array<{ total_hits?: unknown }>, Array<{ user_id?: unknown }>];

      return res.status(200).json({
        total: toSafeInteger(statsRows[0]?.total_hits),
        visitors: visitorRows.length,
        dayKey,
        storage: 'supabase',
      });
    }

    if (isProductionRuntime()) {
      throw new Error('Missing Supabase config in production runtime');
    }

    const store = getMemoryStore();
    return res.status(200).json({
      total: store.total,
      visitors: store.visitors.size,
      dayKey: store.dayKey,
      storage: 'memory',
    });
  } catch (error) {
    console.error('Failed to read totals:', error);
    return res.status(500).json({
      error: 'Failed to read totals',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
