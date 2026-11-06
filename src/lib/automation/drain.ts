import type { SupabaseClient } from '@supabase/supabase-js';
import { runAutomationForEvent } from './engine.js';
import type { AutomationStore, EventRow, HandlerResult } from './types.js';

export const MAX_ATTEMPTS = 5;
const MAX_ERROR_LEN = 300;

export interface DrainSummary {
  scanned: number;
  done: number;
  retried: number;
  dead: number;
}

/** 2, 4, 8, 16 min... (2^tentativas) */
export function backoffAt(attempts: number, now = Date.now()): string {
  return new Date(now + Math.pow(2, attempts) * 60_000).toISOString();
}

export type Handler = (store: AutomationStore, event: EventRow) => Promise<HandlerResult>;

/**
 * Drena a fila: reivindica eventos (SKIP LOCKED), processa e marca done / retry / dead.
 * Entrega é "pelo menos uma vez": as ações são idempotentes (dedupe de tarefa e
 * UNIQUE (rule_id, event_id) nas execuções).
 */
export async function drainEvents(
  admin: SupabaseClient,
  store: AutomationStore,
  opts: { limit?: number; handler?: Handler; now?: () => number } = {}
): Promise<DrainSummary> {
  const handler = opts.handler ?? runAutomationForEvent;
  const now = opts.now ?? Date.now;
  const summary: DrainSummary = { scanned: 0, done: 0, retried: 0, dead: 0 };

  const { data, error } = await admin.rpc('fn_claim_events', { p_limit: opts.limit ?? 20 });
  if (error) throw new Error(`claim: ${error.message}`);
  const events = (data ?? []) as EventRow[];
  summary.scanned = events.length;

  for (const event of events) {
    let result: HandlerResult;
    try {
      result = await handler(store, event);
    } catch (err) {
      result = { status: 'error', detail: err instanceof Error ? err.message : String(err) };
    }

    if (result.status !== 'error') {
      await admin
        .from('event_log')
        .update({ status: 'done', processed_at: new Date(now()).toISOString(), last_error: null, locked_at: null })
        .eq('id', event.id);
      summary.done++;
      continue;
    }

    const message = (result.detail ?? 'erro').slice(0, MAX_ERROR_LEN);
    if (event.attempts >= MAX_ATTEMPTS) {
      await admin.from('event_log').update({ status: 'dead', last_error: message, locked_at: null }).eq('id', event.id);
      summary.dead++;
      await alertDeadEvent(store, event, message);
    } else {
      await admin
        .from('event_log')
        .update({ status: 'pending', last_error: message, locked_at: null, next_attempt_at: backoffAt(event.attempts, now()) })
        .eq('id', event.id);
      summary.retried++;
    }
  }
  return summary;
}

/**
 * Evento que esgotou as tentativas não pode sumir em silêncio: abre uma tarefa crítica.
 * Dedupe único para a fila inteira, para uma pane não inundar o painel.
 */
async function alertDeadEvent(store: AutomationStore, event: EventRow, message: string): Promise<void> {
  try {
    await store.createTask({
      companyId: event.company_id,
      csmId: null,
      ruleId: null,
      title: 'Uma automação parou de tentar',
      body: `Evento ${event.event_type} (${event.id}) esgotou ${MAX_ATTEMPTS} tentativas. Último erro: ${message}`,
      severity: 'critical',
      dedupeKey: 'event_dead'
    });
  } catch {
    // Avisar não pode derrubar o dreno.
  }
}
