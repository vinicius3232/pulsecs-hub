import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { bearerToken, rateLimited, safeEqual } from './_lib/security.js';
import { logStructured } from './_lib/logger.js';
import { parseDeal, processDeal, type SalezDb } from '../src/lib/salez.js';

const PG_UNIQUE_VIOLATION = '23505';

function ip(req: VercelRequest): string {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

/**
 * Negócio ganho (Salez) -> empresa em Kickoff.
 * Segredo compartilhado (SALEZ_WEBHOOK_SECRET, falha fechada). Idempotente: a chave da entrega
 * (deal_id, ou hash de nome+e-mail+telefone) é reservada no banco ANTES de criar a empresa.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const secret = process.env.SALEZ_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'Webhook not configured' });

  if (await rateLimited(`salez:${ip(req)}`, 60, 60_000)) return res.status(429).json({ error: 'Too Many Requests' });

  const provided = String(req.headers['x-webhook-secret'] || '') || bearerToken(req);
  if (!provided || !safeEqual(provided, secret)) {
    logStructured({ level: 'warn', route: 'api/salez-webhook', message: 'Tentativa de acesso com segredo inválido' });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return res.status(503).json({ error: 'Database not configured' });

  const parsed = parseDeal(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.reason });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const db: SalezDb = {
    async claim(source, key) {
      const { error } = await admin.from('webhook_deliveries').insert({ source, external_id: key });
      if (!error) return 'claimed';
      if (error.code === PG_UNIQUE_VIOLATION) return 'duplicate';
      throw new Error('claim: ' + error.message);
    },
    async release(source, key) {
      await admin.from('webhook_deliveries').delete().eq('source', source).eq('external_id', key);
    },
    async complete(source, key, companyId) {
      await admin.from('webhook_deliveries').update({ company_id: companyId }).eq('source', source).eq('external_id', key);
    },
    async insertCompany(c) {
      const { data, error } = await admin.from('companies').insert({ name: c.name, mrr: c.mrr, tier: c.tier, phase: 'Kickoff' }).select('id').single();
      if (error || !data) throw new Error('company: ' + (error?.message ?? 'sem retorno'));
      return { id: data.id };
    },
    async insertContact(c) {
      const { error } = await admin.from('contacts').insert({ ...c, is_decision_maker: true });
      if (error) throw new Error('contact: ' + error.message);
    }
  };

  try {
    const result = await processDeal(db, parsed.deal);
    logStructured({
      level: 'info',
      route: 'api/salez-webhook',
      id: result.status === 'created' ? result.companyId : undefined,
      message: 'Entrega de webhook processada',
      meta: { status: result.status }
    });
    return res.status(200).json(result.status === 'created' ? { status: 'success', company_id: result.companyId } : { status: 'duplicate' });
  } catch (err) {
    logStructured({
      level: 'error',
      route: 'api/salez-webhook',
      message: (err as Error)?.message || 'Erro ao processar webhook Salez'
    });
    return res.status(500).json({ error: 'Webhook Processing Error' });
  }
}
