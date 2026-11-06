import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { bearerToken, rateLimited, safeEqual } from '../_lib/security.js';
import { parseBatch, parseMetricsItem } from '../../src/lib/ingest.js';

/**
 * Telemetria da plataforma de benefícios: POST { items: [{ company_id | cnpj, eligible_lives,
 * active_lives, mau_lives, total_savings?, nps_score?, has_overdue_invoice?, last_login_at? }] }
 *
 * Segredo compartilhado em INGEST_SECRET (cabeçalho x-ingest-secret ou Bearer); falha fechada se ausente.
 * Cada empresa atualizada tem o Health Score recalculado pelo banco (gatilho) e ganha snapshot do dia.
 * Idempotente: reenviar o mesmo lote deixa o mesmo estado.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const secret = process.env.INGEST_SECRET;
  if (!secret) return res.status(503).json({ error: 'Ingestion not configured' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (await rateLimited(`ingest:${ip}`, 30, 60_000)) return res.status(429).json({ error: 'Too Many Requests' });

  const provided = String(req.headers['x-ingest-secret'] || '') || bearerToken(req);
  if (!provided || !safeEqual(provided, secret)) return res.status(401).json({ error: 'Unauthorized' });

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return res.status(503).json({ error: 'Database not configured' });

  const batch = parseBatch(req.body);
  if (!batch.ok) return res.status(400).json({ error: batch.reason });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const failed: Array<{ index: number; reason: string }> = [];
  let updated = 0;

  // Em blocos de 10 para não abrir centenas de conexões ao mesmo tempo
  for (let start = 0; start < batch.items.length; start += 10) {
    await Promise.all(batch.items.slice(start, start + 10).map(async (raw, offset) => {
      const index = start + offset;
      const parsed = parseMetricsItem(raw);
      if (!parsed.ok) { failed.push({ index, reason: parsed.reason }); return; }
      try {
        const q = admin.from('companies').update(parsed.patch).select('id');
        const { data, error } = await (parsed.target.kind === 'id' ? q.eq('id', parsed.target.value) : q.eq('cnpj', parsed.target.value));
        if (error) {
          // O CHECK do banco recusa números incoerentes (ex.: ativadas > elegíveis)
          failed.push({ index, reason: /companies_lives_consistent|check constraint/i.test(error.message) ? 'números incoerentes (ativadas > elegíveis ou MAU > ativadas)' : 'erro ao gravar' });
          return;
        }
        if (!data || data.length === 0) { failed.push({ index, reason: 'empresa não encontrada' }); return; }
        updated += data.length;
      } catch {
        failed.push({ index, reason: 'erro ao gravar' });
      }
    }));
  }

  failed.sort((a, b) => a.index - b.index);
  // 200 mesmo com falhas parciais: quem envia lê "failed" para reenviar só o que faltou
  return res.status(200).json({ received: batch.items.length, updated, failed });
}
