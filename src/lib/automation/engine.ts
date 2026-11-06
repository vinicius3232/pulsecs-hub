import { ensureActionsRegistered, runAction } from './actions';
import { evaluateConditions } from './conditions';
import type { ActionResult, AutomationStore, EventRow, HandlerResult, RunStatus } from './types';

/**
 * Motor de regras: para um evento, executa as regras ativas do tipo que casam.
 *
 * Anti-loop: evento causado por uma regra (metadata.caused_by_rule) não
 * reprocessa regra. Ações atuais só criam tarefas, mas a guarda fica pronta
 * para ações futuras que emitam eventos.
 */
export async function runAutomationForEvent(store: AutomationStore, event: EventRow): Promise<HandlerResult> {
  ensureActionsRegistered();

  if (event.metadata?.caused_by_rule) {
    return { status: 'skipped', detail: 'caused_by_rule' };
  }

  const rules = await store.activeRulesFor(event.event_type);
  if (!rules.length) return { status: 'ok', detail: 'no_rules' };

  // Contexto: payload do evento + linha atual da empresa (a versão de agora, não a do evento)
  const context: Record<string, unknown> = { event: event.payload };
  if (event.company_id) {
    const company = await store.companyContext(event.company_id);
    if (company) context.company = company;
  }

  const applicable = rules.filter(r => evaluateConditions(r.conditions ?? [], context));
  if (!applicable.length) return { status: 'ok', detail: 'no_match' };

  for (const rule of applicable) {
    const results: ActionResult[] = [];
    for (const spec of rule.actions ?? []) {
      results.push(await runAction(spec, { store, rule, event, context }));
    }

    // Status honesto: "duplicate" (já havia tarefa aberta) é sucesso; "skipped" e "failed" não.
    const notDone = results.filter(r => r.status === 'failed' || r.status === 'skipped').length;
    const status: RunStatus =
      notDone === 0 ? 'success' : notDone === results.length ? 'failed' : 'partial';

    await store.recordRun({ ruleId: rule.id, eventId: event.id, status, actions: results });
  }

  return { status: 'ok' };
}
