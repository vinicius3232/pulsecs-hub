// Validação do lote de métricas enviado pela plataforma de benefícios (puro, sem I/O).

export interface MetricsPatch {
  eligible_lives?: number;
  active_lives?: number;
  mau_lives?: number;
  total_savings?: number;
  nps_score?: number | null;
  has_overdue_invoice?: boolean;
  last_login_at?: string;
}

export type Target =
  | { kind: 'id'; value: string }
  | { kind: 'cnpj'; value: string }
  | { kind: 'platform_id'; value: string };

export type Parsed =
  | { ok: true; target: Target; patch: MetricsPatch }
  | { ok: false; reason: string };

export const MAX_ITEMS = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LIVES = 10_000_000;

const isInt = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;

/**
 * Item aceito: { company_id (uuid) OU cnpj (14 dígitos), + ao menos uma métrica }.
 * Só entram as chaves conhecidas; qualquer outra é ignorada (nunca vai para o UPDATE).
 * A coerência entre os números (ativadas <= elegíveis...) é garantida pelo CHECK do banco.
 */
export function parseMetricsItem(raw: unknown, now: Date = new Date()): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'item deve ser um objeto' };
  const r = raw as Record<string, unknown>;

  let target: Target;
  if (typeof r.company_id === 'string') {
    if (!UUID.test(r.company_id)) return { ok: false, reason: 'company_id inválido' };
    target = { kind: 'id', value: r.company_id.toLowerCase() };
  } else if (typeof r.cnpj === 'string') {
    const digits = r.cnpj.replace(/\D/g, '');
    if (digits.length !== 14) return { ok: false, reason: 'cnpj deve ter 14 dígitos' };
    target = { kind: 'cnpj', value: digits };
  } else if (typeof r.platform_id === 'string' || typeof r.external_id === 'string') {
    const rawVal = typeof r.platform_id === 'string' ? r.platform_id : (r.external_id as string);
    const val = rawVal.trim();
    if (!val || val.length > 128) return { ok: false, reason: 'platform_id deve ter entre 1 e 128 caracteres' };
    target = { kind: 'platform_id', value: val };
  } else {
    return { ok: false, reason: 'informe company_id, cnpj ou platform_id' };
  }

  const patch: MetricsPatch = {};
  for (const k of ['eligible_lives', 'active_lives', 'mau_lives'] as const) {
    if (r[k] === undefined) continue;
    if (!isInt(r[k], MAX_LIVES)) return { ok: false, reason: `${k} deve ser inteiro entre 0 e ${MAX_LIVES}` };
    patch[k] = r[k] as number;
  }
  if (r.total_savings !== undefined) {
    if (typeof r.total_savings !== 'number' || !Number.isFinite(r.total_savings) || r.total_savings < 0 || r.total_savings > 1e12) {
      return { ok: false, reason: 'total_savings deve ser um número >= 0' };
    }
    patch.total_savings = Math.round(r.total_savings * 100) / 100;
  }
  if (r.nps_score !== undefined) {
    if (r.nps_score !== null && (typeof r.nps_score !== 'number' || !Number.isFinite(r.nps_score) || r.nps_score < 0 || r.nps_score > 10)) {
      return { ok: false, reason: 'nps_score deve estar entre 0 e 10 (ou null)' };
    }
    patch.nps_score = r.nps_score === null ? null : Math.round((r.nps_score as number) * 10) / 10;
  }
  if (r.has_overdue_invoice !== undefined) {
    if (typeof r.has_overdue_invoice !== 'boolean') return { ok: false, reason: 'has_overdue_invoice deve ser booleano' };
    patch.has_overdue_invoice = r.has_overdue_invoice;
  }
  if (r.last_login_at !== undefined) {
    const d = typeof r.last_login_at === 'string' ? new Date(r.last_login_at) : null;
    if (!d || Number.isNaN(d.getTime())) return { ok: false, reason: 'last_login_at deve ser uma data ISO' };
    if (d.getTime() > now.getTime() + 86_400_000) return { ok: false, reason: 'last_login_at no futuro' };
    patch.last_login_at = d.toISOString();
  }
  if (Object.keys(patch).length === 0) return { ok: false, reason: 'nenhuma métrica informada' };
  return { ok: true, target, patch };
}

export function parseBatch(body: unknown): { ok: true; items: unknown[] } | { ok: false; reason: string } {
  const items = body && typeof body === 'object' ? (body as { items?: unknown }).items : undefined;
  if (!Array.isArray(items)) return { ok: false, reason: 'corpo deve ser { "items": [...] }' };
  if (items.length === 0) return { ok: false, reason: 'lote vazio' };
  if (items.length > MAX_ITEMS) return { ok: false, reason: `lote excede ${MAX_ITEMS} itens` };
  return { ok: true, items };
}
