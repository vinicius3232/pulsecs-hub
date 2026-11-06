import type { VercelRequest, VercelResponse } from '@vercel/node';
import { bearerToken, rateLimited, safeEqual } from './_lib/security';

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const digits = (v: unknown, max: number) => str(v, 40).replace(/\D/g, '').slice(0, max);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ip(req: VercelRequest): string {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 1. Segredo compartilhado (falha fechada se não configurado)
  const secret = process.env.SALEZ_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'Webhook not configured' });

  if (rateLimited(`salez:${ip(req)}`, 60, 60_000)) {
    return res.status(429).json({ error: 'Too Many Requests' });
  }

  const provided = String(req.headers['x-webhook-secret'] || '') || bearerToken(req);
  if (!provided || !safeEqual(provided, secret)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supaUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !serviceKey) return res.status(503).json({ error: 'Database not configured' });

  // 2. Validação do payload
  const p = (req.body && typeof req.body === 'object') ? req.body : {};
  const name = str(p.company_name, 120);
  if (!name) return res.status(400).json({ error: 'company_name is required' });

  const mrr = Number(p.mrr ?? p.deal_value ?? p.value);
  if (!Number.isFinite(mrr) || mrr < 0 || mrr > 10_000_000) {
    return res.status(400).json({ error: 'invalid mrr' });
  }

  const contactName = str(p.contact_name, 120) || 'Responsável';
  const contactEmail = str(p.email, 200).toLowerCase();
  const contactPhone = digits(p.phone ?? p.whatsapp, 15);

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json'
  };

  try {
    // 3. Idempotência simples: a Salez pode reenviar o mesmo evento
    const dup = await fetch(
      `${supaUrl}/rest/v1/companies?name=eq.${encodeURIComponent(name)}&select=id&limit=1`,
      { headers }
    );
    if (dup.ok && (await dup.json()).length > 0) {
      return res.status(200).json({ status: 'duplicate' });
    }

    // 4. Grava a empresa em Kickoff
    const created = await fetch(`${supaUrl}/rest/v1/companies`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ name, mrr, phase: 'Kickoff', tier: mrr >= 12000 ? 'Enterprise' : mrr >= 6000 ? 'Mid-Market' : 'SMB' })
    });
    if (!created.ok) {
      console.error('Salez webhook: company insert failed', created.status);
      return res.status(502).json({ error: 'Could not store deal' });
    }
    const [company] = await created.json();

    // 5. Contato (a coluna email é NOT NULL: só cria se houver e-mail válido)
    if (company?.id && EMAIL_RE.test(contactEmail)) {
      const c = await fetch(`${supaUrl}/rest/v1/contacts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          company_id: company.id,
          name: contactName,
          email: contactEmail,
          phone: contactPhone || null,
          is_decision_maker: true
        })
      });
      if (!c.ok) console.error('Salez webhook: contact insert failed', c.status);
    }

    // Não registra dados pessoais (telefone/e-mail) nos logs.
    console.log('Salez deal stored', company?.id);
    return res.status(200).json({ status: 'success', company_id: company?.id });
  } catch (err) {
    console.error('Salez webhook error', (err as Error)?.name);
    return res.status(500).json({ error: 'Webhook Processing Error' });
  }
}
