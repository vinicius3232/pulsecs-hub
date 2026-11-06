import { timingSafeEqual } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Diretórios/arquivos iniciados por "_" não viram rotas na Vercel.

/** Origens liberadas via env ALLOWED_ORIGINS (separadas por vírgula). Sem env = só mesma origem. */
export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  const allowed = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const origin = String(req.headers.origin || '');
  res.setHeader('Vary', 'Origin');
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  // Origem de navegador não autorizada: bloqueia (chamadas servidor-a-servidor não enviam Origin).
  if (origin && !allowed.includes(origin) && !isSameOrigin(req, origin)) {
    res.status(403).json({ error: 'Origin not allowed' });
    return true;
  }
  return false;
}

function isSameOrigin(req: VercelRequest, origin: string): boolean {
  try {
    return new URL(origin).host === String(req.headers.host || '');
  } catch {
    return false;
  }
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function bearerToken(req: VercelRequest): string {
  const h = String(req.headers.authorization || '');
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

/** Valida o JWT do Supabase Auth e devolve o id do usuário (ou null). */
export async function getSupabaseUserId(token: string): Promise<string | null> {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon || !token) return null;
  try {
    const r = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anon, Authorization: `Bearer ${token}` }
    });
    if (!r.ok) return null;
    const u = await r.json();
    return typeof u?.id === 'string' ? u.id : null;
  } catch {
    return null;
  }
}

// Limite por usuário em memória. Em serverless cada instância tem o seu contador,
// então é uma proteção de melhor esforço; para limite global use Upstash/Vercel KV.
const hits = new Map<string, number[]>();
export function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
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
