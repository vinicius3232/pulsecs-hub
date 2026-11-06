import { ensureActionsRegistered, runAction, runIf, type ActionCtx } from './actions.js';
import { evaluateConditions } from './conditions.js';
import type {
  ActionResult, ActionSpec, AutomationStore, EventRow, HandlerResult, RuleRow, RunStatus, ScheduledStep
} from './types.js';

/** Gatilho manual: a regra a executar vem em payload.rule_id e a regra tem trigger_event = 'manual.run'. */
export const MANUAL_TRIGGER = 'manual.run';

const MAX_DELAY_MS = 90 * 24 * 60 * 60 * 1000;

/** Espera pedida pelo passo `delay` ({days, hours}); 0 < espera <= 90 dias, senão null. */
export function delayMs(config: Record<string, unknown> | undefined): number | null {
  const days = Number(config?.days ?? 0);
  const hours = Number(config?.hours ?? 0);
  if (!Number.isFinite(days) || !Number.isFinite(hours) || days < 0 || hours < 0) return null;
  const ms = days * 86_400_000 + hours * 3_600_000;
  return ms > 0 && ms <= MAX_DELAY_MS ? ms : null;
}

export interface EngineOpts {
  now?: () => number;
}

/**
 * Executa os passos da regra a partir de `startIndex`. Se encontra um `delay`,
 * agenda a retomada e para ('waiting'). Resultados acumulam em `results`.
 */
async function runSteps(
  steps: ActionSpec[],
  startIndex: number,
  ctx: ActionCtx,
  results: ActionResult[],
  now: number
): Promise<'finished' | 'waiting'> {
  for (let i = startIndex; i < steps.length; i++) {
    const step = steps[i];

    if (step.type === 'delay') {
      const ms = delayMs(step.config);
      if (ms === null) {
        results.push({ type: 'delay', status: 'failed', detail: 'espera_invalida' });
        return 'finished';
      }
      const resumeAt = new Date(now + ms).toISOString();
      await ctx.store.scheduleResume({
        ruleId: ctx.rule.id,
        eventId: ctx.event.id,
        companyId: ctx.event.company_id,
        eventType: ctx.event.event_type,
        payload: ctx.event.payload,
        nextIndex: i + 1,
        resumeAt
      });
      results.push({ type: 'delay', status: 'scheduled', detail: resumeAt });
      return 'waiting';
    }

    if (step.type === 'if') results.push(...(await runIf(step, ctx)));
    else results.push(await runAction(step, ctx));
  }
  return 'finished';
}

/** Status honesto: "duplicate" e "scheduled" não são falha; "skipped" e "failed" contam como não feito. */
export function summarize(results: ActionResult[], waiting: boolean): RunStatus {
  const notDone = results.filter(r => r.status === 'failed' || r.status === 'skipped').length;
  if (notDone === 0) return waiting ? 'waiting' : 'success';
  const real = results.filter(r => r.type !== 'if').length || results.length;
  return notDone >= real ? 'failed' : 'partial';
}

async function buildContext(store: AutomationStore, payload: Record<string, unknown>, companyId: string | null) {
  const context: Record<string, unknown> = { event: payload };
  if (companyId) {
    const company = await store.companyContext(companyId);
    if (company) context.company = company;
  }
  return context;
}

/**
 * Motor de regras: para um evento, executa as regras ativas do tipo que casam.
 * Anti-loop: evento causado por regra (metadata.caused_by_rule) não reprocessa regra.
 */
export async function runAutomationForEvent(
  store: AutomationStore,
  event: EventRow,
  opts: EngineOpts = {}
): Promise<HandlerResult> {
  ensureActionsRegistered();
  const now = (opts.now ?? Date.now)();

  if (event.metadata?.caused_by_rule) return { status: 'skipped', detail: 'caused_by_rule' };

  let rules = await store.activeRulesFor(event.event_type);

  // Evento dirigido: só a regra apontada (como o gatilho manual do Twenty / regra do relógio do Deskcomm)
  if (event.event_type === MANUAL_TRIGGER) {
    const wanted = event.payload?.rule_id;
    rules = rules.filter(r => r.id === wanted);
  }
  if (!rules.length) return { status: 'ok', detail: 'no_rules' };

  const context = await buildContext(store, event.payload, event.company_id);
  const applicable = rules.filter(r => evaluateConditions(r.conditions ?? [], context));
  if (!applicable.length) return { status: 'ok', detail: 'no_match' };

  for (const rule of applicable) {
    const results: ActionResult[] = [];
    const outcome = await runSteps(rule.actions ?? [], 0, { store, rule, event, context }, results, now);
    await store.recordRun({
      ruleId: rule.id,
      eventId: event.id,
      status: summarize(results, outcome === 'waiting'),
      actions: results
    });
  }
  return { status: 'ok' };
}

/**
 * Retoma uma regra pausada por `delay`. O contexto é refeito (empresa AGORA, payload do evento
 * original). Regra desativada ou removida cancela a espera.
 */
export async function resumeScheduledStep(
  store: AutomationStore,
  step: ScheduledStep,
  opts: EngineOpts = {}
): Promise<'done' | 'cancelled'> {
  ensureActionsRegistered();
  const now = (opts.now ?? Date.now)();

  const rule = await store.ruleById(step.rule_id);
  if (!rule || rule.is_active === false) {
    await store.finishScheduled(step.id, 'cancelled', 'regra_inativa_ou_removida');
    return 'cancelled';
  }

  const event: EventRow = {
    id: step.event_id,
    event_type: step.event_type,
    entity_kind: 'company',
    entity_id: step.company_id,
    company_id: step.company_id,
    payload: step.payload,
    metadata: {},
    external_id: null,
    status: 'processing',
    attempts: 0
  };
  const context = await buildContext(store, step.payload, step.company_id);

  const results = await store.getRunActions(rule.id, step.event_id);
  // As esperas anteriores já terminaram: deixam de constar como "agendadas".
  for (const r of results) if (r.type === 'delay' && r.status === 'scheduled') r.status = 'done';
  const outcome = await runSteps(rule.actions ?? [], step.next_index, { store, rule, event, context }, results, now);
  await store.recordRun({
    ruleId: rule.id,
    eventId: step.event_id,
    status: summarize(results, outcome === 'waiting'),
    actions: results
  });
  await store.finishScheduled(step.id, 'done');
  return 'done';
}

export type { RuleRow };
