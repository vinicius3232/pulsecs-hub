import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { applyCors, bearerToken, getSupabaseUserId, rateLimited } from '../_lib/security.js';
import { logStructured } from '../_lib/logger.js';
import { drainEvents } from '../../src/lib/automation/drain.js';
import { MANUAL_TRIGGER } from '../../src/lib/automation/engine.js';
import { createSupabaseStore } from '../../src/lib/automation/supabase-store.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Gatilho manual: POST { rule_id, company_id } executa uma regra com trigger_event = "manual.run"
 * para uma empresa, na hora. Exige sessão Supabase; head executa em qualquer empresa,
 * csm só nas suas.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const authId = await getSupabaseUserId(bearerToken(req));
  if (!authId) return res.status(401).json({ error: 'Unauthorized' });
  if (await rateLimited(`run:${authId}`, 30, 60_000)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'Too Many Requests' });
  }

  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const ruleId = String(body.rule_id ?? '');
  const companyId = String(body.company_id ?? '');
  if (!UUID.test(ruleId) || !UUID.test(companyId)) return res.status(400).json({ error: 'rule_id e company_id devem ser UUID' });

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return res.status(503).json({ error: 'Database not configured' });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    // Papel do usuário (a role vem do banco, nunca do corpo da requisição)
    const { data: user } = await admin
      .from('csm_users').select('id, role, is_active').eq('auth_id', authId).maybeSingle();
    if (!user || !user.is_active || !['head', 'csm'].includes(user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { data: company } = await admin.from('companies').select('id, csm_id').eq('id', companyId).maybeSingle();
    if (!company) return res.status(404).json({ error: 'Company not found' });
    if (user.role !== 'head' && company.csm_id !== user.id) return res.status(403).json({ error: 'Forbidden' });

    const { data: rule } = await admin
      .from('automation_rules').select('id, trigger_event, is_active').eq('id', ruleId).maybeSingle();
    if (!rule || !rule.is_active || rule.trigger_event !== MANUAL_TRIGGER) {
      return res.status(404).json({ error: 'Manual rule not found' });
    }

    const { data: event, error: evErr } = await admin
      .from('event_log')
      .insert({
        event_type: MANUAL_TRIGGER,
        entity_kind: 'company',
        entity_id: companyId,
        company_id: companyId,
        payload: { rule_id: ruleId, triggered_by: user.id }
      })
      .select('id')
      .single();
    if (evErr || !event) throw new Error('event insert failed');

    // Processa na hora (sem esperar o cron diário)
    const summary = await drainEvents(admin, createSupabaseStore(admin), { limit: 20 });

    logStructured({
      level: 'info',
      route: 'api/automation/run',
      id: event.id,
      message: 'Regra manual executada',
      meta: { ruleId, companyId, drain: summary }
    });

    return res.status(200).json({ status: 'executed', event_id: event.id, drain: summary });
  } catch (err) {
    logStructured({
      level: 'error',
      route: 'api/automation/run',
      id: ruleId,
      message: (err as Error)?.message || 'Falha ao executar regra'
    });
    return res.status(500).json({ error: 'Run failed' });
  }
}
