import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { bearerToken, safeEqual } from '../_lib/security.js';
import { drainEvents, drainScheduled } from '../../src/lib/automation/drain.js';
import { createSupabaseStore } from '../../src/lib/automation/supabase-store.js';

/**
 * Cron diário: emite eventos guiados pelo relógio (renovação próxima, RH sem login),
 * drena a fila do event_log e retoma as regras pausadas por `delay` cujo horário chegou.
 * A Vercel envia `Authorization: Bearer $CRON_SECRET`. Sem CRON_SECRET, falha fechada.
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
    // 1) Recalcula o Health Score de todas as empresas com métricas (dias de renovação e de RH mudam todo dia)
    //    e grava o snapshot do dia. Mudança de status gera evento para as regras.
    const { data: recomputed, error: healthErr } = await admin.rpc('fn_recompute_health');
    if (healthErr) throw new Error(`health: ${healthErr.message}`);

    // 2) Eventos guiados pelo relógio (renovação próxima, RH sem login)
    const { data: emitted, error: emitErr } = await admin.rpc('fn_emit_time_events');
    if (emitErr) throw new Error(`emit: ${emitErr.message}`);

    const store = createSupabaseStore(admin);

    // Até 5 lotes de 20 por execução (cabe no limite de tempo da função).
    const events = { scanned: 0, done: 0, retried: 0, dead: 0 };
    for (let i = 0; i < 5; i++) {
      const s = await drainEvents(admin, store, { limit: 20 });
      events.scanned += s.scanned;
      events.done += s.done;
      events.retried += s.retried;
      events.dead += s.dead;
      if (s.scanned < 20) break;
    }

    // Esperas vencidas (inclui as criadas agora, se o delay já passou)
    const scheduled = { scanned: 0, resumed: 0, cancelled: 0, retried: 0, failed: 0 };
    for (let i = 0; i < 5; i++) {
      const s = await drainScheduled(store, { limit: 20 });
      scheduled.scanned += s.scanned;
      scheduled.resumed += s.resumed;
      scheduled.cancelled += s.cancelled;
      scheduled.retried += s.retried;
      scheduled.failed += s.failed;
      if (s.scanned < 20) break;
    }
    return res.status(200).json({ recomputed: recomputed ?? 0, emitted: emitted ?? 0, events, scheduled });
  } catch (err) {
    console.error('drain-events error', (err as Error)?.message);
    return res.status(500).json({ error: 'Drain failed' });
  }
}
