import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { applyCors, bearerToken, getSupabaseUserId, rateLimited } from '../_lib/security.js';
import { validateRuleInput } from '../../src/lib/automation/rules-validator.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Gestão de regras de automação (Criar, Editar, Excluir).
 * Exclusivo para o papel 'head' (autenticado via JWT do Supabase).
 * Falha fechada: 401 (sem token válido), 403 (não é head), 405 (método não permitido), 400 (dados inválidos).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;

  const method = req.method?.toUpperCase();
  if (!['POST', 'PUT', 'DELETE'].includes(method ?? '')) {
    res.setHeader('Allow', 'POST, PUT, DELETE');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const token = bearerToken(req);
  const authId = await getSupabaseUserId(token);
  if (!authId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (await rateLimited(`rules:${authId}`, 30, 60_000)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'Too Many Requests' });
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  try {
    // Validação estrita do papel: só o Head pode gerenciar regras
    const { data: user, error: userErr } = await admin
      .from('csm_users')
      .select('id, role, is_active')
      .eq('auth_id', authId)
      .maybeSingle();

    if (userErr || !user || !user.is_active || user.role !== 'head') {
      return res.status(403).json({ error: 'Forbidden: apenas o Head pode gerenciar regras' });
    }

    if (method === 'POST') {
      const val = validateRuleInput(req.body);
      if (!val.valid || !val.data) {
        return res.status(400).json({ error: 'Regra inválida', details: val.errors });
      }

      const { data, error } = await admin
        .from('automation_rules')
        .insert({
          name: val.data.name,
          trigger_event: val.data.trigger_event,
          conditions: val.data.conditions,
          actions: val.data.actions,
          is_active: val.data.is_active
        })
        .select('id, name, trigger_event, conditions, actions, is_active, created_at, updated_at')
        .single();

      if (error || !data) {
        return res.status(500).json({ error: `Erro ao criar regra: ${error?.message || 'desconhecido'}` });
      }

      return res.status(201).json({ ok: true, rule: data });
    }

    if (method === 'PUT') {
      const rawId = req.query.id ?? (req.body && typeof req.body === 'object' ? req.body.id : undefined);
      const ruleId = String(rawId ?? '').trim();
      if (!UUID_REGEX.test(ruleId)) {
        return res.status(400).json({ error: 'ID da regra deve ser um UUID válido' });
      }

      const val = validateRuleInput(req.body);
      if (!val.valid || !val.data) {
        return res.status(400).json({ error: 'Regra inválida', details: val.errors });
      }

      const { data, error } = await admin
        .from('automation_rules')
        .update({
          name: val.data.name,
          trigger_event: val.data.trigger_event,
          conditions: val.data.conditions,
          actions: val.data.actions,
          is_active: val.data.is_active,
          updated_at: new Date().toISOString()
        })
        .eq('id', ruleId)
        .select('id, name, trigger_event, conditions, actions, is_active, updated_at')
        .maybeSingle();

      if (error) {
        return res.status(500).json({ error: `Erro ao atualizar regra: ${error.message}` });
      }
      if (!data) {
        return res.status(404).json({ error: 'Regra não encontrada' });
      }

      return res.status(200).json({ ok: true, rule: data });
    }

    if (method === 'DELETE') {
      const rawId = req.query.id ?? (req.body && typeof req.body === 'object' ? req.body.id : undefined);
      const ruleId = String(rawId ?? '').trim();
      if (!UUID_REGEX.test(ruleId)) {
        return res.status(400).json({ error: 'ID da regra deve ser um UUID válido' });
      }

      const { error } = await admin.from('automation_rules').delete().eq('id', ruleId);
      if (error) {
        return res.status(500).json({ error: `Erro ao excluir regra: ${error.message}` });
      }

      return res.status(200).json({ ok: true });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Erro interno ao processar regra' });
  }
}
