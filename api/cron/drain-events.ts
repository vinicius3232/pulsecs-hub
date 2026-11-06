import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { bearerToken, safeEqual } from '../_lib/security';
import { drainEvents } from '../../src/lib/automation/drain';
import { createSupabaseStore } from '../../src/lib/automation/supabase-store';

/**
 * Cron diário: emite eventos guiados pelo relógio (renovação próxima, RH sem login)
 * e drena a fila do event_log. A Vercel envia `Authorization: Bearer $CRON_SECRET`.
 * Sem CRON_SECRET configurado, falha fechada.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: 'Cron not configured' });
  const provided = bearerToken(req);
  if (!provided || !safeEqual(provided, secret)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return res.status(503).json({ error: 'Database not configured' });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const { data: emitted, error: emitErr } = await admin.rpc('fn_emit_time_events');
    if (emitErr) throw new Error(`emit: ${emitErr.message}`);

    // Até 5 lotes de 20 por execução (cabe no limite de tempo da função).
    const store = createSupabaseStore(admin);
    const total = { scanned: 0, done: 0, retried: 0, dead: 0 };
    for (let i = 0; i < 5; i++) {
      const s = await drainEvents(admin, store, { limit: 20 });
      total.scanned += s.scanned;
      total.done += s.done;
      total.retried += s.retried;
      total.dead += s.dead;
      if (s.scanned < 20) break;
    }
    return res.status(200).json({ emitted: emitted ?? 0, ...total });
  } catch (err) {
    console.error('drain-events error', (err as Error)?.message);
    return res.status(500).json({ error: 'Drain failed' });
  }
}
