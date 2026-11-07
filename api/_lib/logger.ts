/**
 * Logger estruturado para funções de api/.
 * Emite uma linha JSON com timestamp, level, route, id e mensagem.
 * Higienização estrita: NUNCA emite e-mail, telefone ou payload bruto (LGPD / Segurança).
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  route: string;
  id?: string;
  message: string;
  meta?: Record<string, unknown>;
}

const SENSITIVE_KEY_REGEX = /^(email|mail|phone|telefone|whatsapp|celular|payload|raw_payload|body)$/i;
const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE_REGEX = /\+?\d[\d\s().-]{7,}\d/g;

export function sanitizeValue(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === 'string') {
    return val
      .replace(EMAIL_REGEX, '[EMAIL_REDACTED]')
      .replace(PHONE_REGEX, '[PHONE_REDACTED]');
  }
  if (Array.isArray(val)) {
    return val.map(sanitizeValue);
  }
  if (typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (SENSITIVE_KEY_REGEX.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = sanitizeValue(v);
      }
    }
    return out;
  }
  return val;
}

export function logStructured(entry: LogEntry): void {
  const sanitizedMeta = entry.meta ? sanitizeValue(entry.meta) as Record<string, unknown> : undefined;
  const payload = {
    timestamp: new Date().toISOString(),
    level: entry.level,
    route: entry.route,
    ...(entry.id ? { id: entry.id } : {}),
    message: typeof entry.message === 'string' ? sanitizeValue(entry.message) : entry.message,
    ...(sanitizedMeta && Object.keys(sanitizedMeta).length > 0 ? { meta: sanitizedMeta } : {})
  };

  const line = JSON.stringify(payload);
  if (entry.level === 'error') {
    console.error(line);
  } else if (entry.level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}
