// Limite de requisições. Global via Upstash Redis (REST), com cai-para-memória se o Redis falhar.
// Janela fixa: INCR em uma chave por janela + PEXPIRE. Sem SDK: uma chamada HTTP de pipeline.

export interface RateEnv {
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

const hits = new Map<string, number[]>();

/** Fallback por instância (serverless: cada instância tem o seu contador). */
export function rateLimitedLocal(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some(t => now - t < windowMs)) hits.delete(k);
  }
  return false;
}

export function _resetLocal(): void { hits.clear(); }

/**
 * true = bloquear. Com Upstash configurado o limite vale para TODAS as instâncias.
 * Se o Redis estiver fora do ar, usa o limite local (degrada, não derruba o endpoint).
 */
export async function rateLimited(
  key: string,
  max: number,
  windowMs: number,
  opts: { env?: RateEnv; fetchImpl?: FetchLike; now?: number } = {}
): Promise<boolean> {
  const env = opts.env ?? (process.env as RateEnv);
  const now = opts.now ?? Date.now();
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return rateLimitedLocal(key, max, windowMs, now);

  const bucket = Math.floor(now / windowMs);
  const redisKey = `rl:${key}:${bucket}`;
  try {
    const f = (opts.fetchImpl ?? (fetch as unknown as FetchLike));
    const res = await f(`${url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['INCR', redisKey], ['PEXPIRE', redisKey, String(windowMs)]]),
      signal: AbortSignal.timeout(1500)
    });
    if (!res.ok) throw new Error('redis http');
    const out = (await res.json()) as Array<{ result?: unknown; error?: string }>;
    const count = Number(out?.[0]?.result);
    if (!Number.isFinite(count) || out?.[0]?.error) throw new Error('redis resposta inválida');
    return count > max;
  } catch {
    return rateLimitedLocal(key, max, windowMs, now);
  }
}
