// Negócio ganho da Salez -> empresa em Kickoff. Lógica pura e idempotente (sem I/O direto).
import { createHash } from 'node:crypto';

export const SOURCE = 'salez';

export interface Deal {
  name: string;
  mrr: number;
  contactName: string;
  email: string;
  phone: string;
  dealId: string | null;
}

export type ParsedDeal = { ok: true; deal: Deal } | { ok: false; reason: string };

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseDeal(raw: unknown): ParsedDeal {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'corpo inválido' };
  const p = raw as Record<string, unknown>;
  const name = str(p.company_name, 120);
  if (!name) return { ok: false, reason: 'company_name é obrigatório' };

  const mrr = Number(p.mrr ?? p.deal_value ?? p.value);
  if (!Number.isFinite(mrr) || mrr < 0 || mrr > 10_000_000) return { ok: false, reason: 'mrr inválido' };

  const idRaw = p.deal_id ?? p.id ?? p.external_id;
  const dealId = typeof idRaw === 'string' || typeof idRaw === 'number' ? String(idRaw).trim().slice(0, 120) : '';

  const email = str(p.email, 200).toLowerCase();
  return {
    ok: true,
    deal: {
      name,
      mrr,
      contactName: str(p.contact_name, 120) || 'Responsável',
      email: EMAIL_RE.test(email) ? email : '',
      phone: str(p.phone ?? p.whatsapp, 40).replace(/\D/g, '').slice(0, 15),
      dealId: dealId || null
    }
  };
}

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Chave de idempotência da entrega.
 * Com `deal_id` da Salez, é ele (reenvio = mesma chave). Sem ele, um hash de nome+e-mail+telefone:
 * o reenvio idêntico é reconhecido e duas empresas homônimas com contatos diferentes NÃO colidem.
 */
export function deliveryKey(d: Deal): string {
  if (d.dealId) return 'deal:' + d.dealId;
  const h = createHash('sha256').update([norm(d.name), d.email, d.phone].join('|')).digest('hex').slice(0, 32);
  return 'hash:' + h;
}

export const tierFor = (mrr: number) => (mrr >= 12000 ? 'Enterprise' : mrr >= 6000 ? 'Mid-Market' : 'SMB');

/** Porta de persistência (Supabase em produção, memória nos testes). */
export interface SalezDb {
  /** Reserva a chave. 'duplicate' se já existir (inclusive reservada por outra requisição em curso). */
  claim(source: string, key: string): Promise<'claimed' | 'duplicate'>;
  release(source: string, key: string): Promise<void>;
  complete(source: string, key: string, companyId: string): Promise<void>;
  insertCompany(c: { name: string; mrr: number; tier: string }): Promise<{ id: string }>;
  insertContact(c: { company_id: string; name: string; email: string; phone: string | null }): Promise<void>;
}

export type DealResult = { status: 'created'; companyId: string } | { status: 'duplicate' };

/**
 * Reserva a chave ANTES do efeito. Se o efeito falhar, libera a reserva para a Salez poder reenviar.
 * Falha ao criar só o contato não desfaz a empresa (já criada e vinculada à entrega).
 */
export async function processDeal(db: SalezDb, deal: Deal): Promise<DealResult> {
  const key = deliveryKey(deal);
  if ((await db.claim(SOURCE, key)) === 'duplicate') return { status: 'duplicate' };

  let companyId: string;
  try {
    const c = await db.insertCompany({ name: deal.name, mrr: deal.mrr, tier: tierFor(deal.mrr) });
    companyId = c.id;
  } catch (err) {
    await db.release(SOURCE, key).catch(() => {});
    throw err;
  }

  await db.complete(SOURCE, key, companyId).catch(() => {});
  if (deal.email) {
    try {
      await db.insertContact({ company_id: companyId, name: deal.contactName, email: deal.email, phone: deal.phone || null });
    } catch {
      // empresa já existe; o contato pode ser cadastrado depois pela tela
    }
  }
  return { status: 'created', companyId };
}
