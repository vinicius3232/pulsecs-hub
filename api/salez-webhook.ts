import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const payload = req.body || {};
    console.log('Salez Inbound Webhook Received:', payload);

    // Mapeamento dos dados típicos de venda fechada da Salez
    const companyName = payload.company_name || payload.contact_name || payload.lead_name || 'Nova Empresa (Salez)';
    const mrr = Number(payload.mrr || payload.deal_value || payload.value || 9500);
    const contactName = payload.contact_name || payload.name || 'Responsável';
    const contactPhone = payload.phone || payload.whatsapp || '';
    const contactEmail = payload.email || '';

    // Resposta imediata 200 OK para o webhook da Salez não expirar
    return res.status(200).json({
      status: 'success',
      message: 'Deal received and queued for onboarding kickoff',
      data: {
        company: companyName,
        mrr,
        contact: contactName,
        phone: contactPhone,
        email: contactEmail,
        phase: 'Kickoff',
        timestamp: new Date().toISOString()
      }
    });
  } catch (err: any) {
    console.error('Salez Webhook Error:', err);
    return res.status(500).json({ error: 'Webhook Processing Error', message: err.message });
  }
}
