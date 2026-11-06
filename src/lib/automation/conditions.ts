import type { RuleCondition } from './types';

/** Lê "a.b.c" de um objeto; devolve undefined se qualquer parte faltar. */
export function resolveField(context: Record<string, unknown>, path: string): unknown {
  let cur: unknown = context;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

function matches(cond: RuleCondition, context: Record<string, unknown>): boolean {
  const raw = resolveField(context, cond.field);

  // Campo ausente: só "neq" é verdadeiro. Comparações numéricas e "eq" falham fechado.
  if (raw === undefined || raw === null) return cond.op === 'neq';

  switch (cond.op) {
    case 'eq':
      return String(raw) === cond.value;
    case 'neq':
      return String(raw) !== cond.value;
    case 'contains': {
      const alvo = cond.value.toLowerCase();
      if (Array.isArray(raw)) return raw.some(item => String(item).toLowerCase() === alvo);
      return String(raw).toLowerCase().includes(alvo);
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = toNumber(raw);
      const b = toNumber(cond.value);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      if (cond.op === 'gt') return a > b;
      if (cond.op === 'gte') return a >= b;
      if (cond.op === 'lt') return a < b;
      return a <= b;
    }
    default:
      return false; // operador desconhecido nunca dispara a regra
  }
}

/** Todas as condições em AND. Lista vazia = sempre verdadeiro. */
export function evaluateConditions(conditions: RuleCondition[], context: Record<string, unknown>): boolean {
  return conditions.every(c => matches(c, context));
}

/** Substitui {{caminho.do.campo}} por texto. Campo ausente vira "—". Sem HTML: o consumidor deve escapar. */
export function interpolate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
    const v = resolveField(context, path);
    return v === undefined || v === null || v === '' ? '—' : String(v);
  });
}
