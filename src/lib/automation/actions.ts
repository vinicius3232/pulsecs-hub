import { interpolate } from './conditions.js';
import type { ActionResult, ActionSpec, AutomationStore, EventRow, RuleRow, Severity } from './types.js';

export interface ActionCtx {
  store: AutomationStore;
  rule: RuleRow;
  event: EventRow;
  context: Record<string, unknown>;
}

export interface ActionExecutor {
  type: string;
  execute(ctx: ActionCtx, config: Record<string, unknown>): Promise<ActionResult>;
}

const registry = new Map<string, ActionExecutor>();

export function registerAction(executor: ActionExecutor): void {
  registry.set(executor.type, executor);
}

export function getAction(type: string): ActionExecutor | undefined {
  return registry.get(type);
}

const SEVERITIES: readonly Severity[] = ['info', 'warn', 'critical'];

/** Cria uma tarefa para o CSM responsável pela empresa (no máximo uma aberta por regra+empresa). */
export const createTaskAction: ActionExecutor = {
  type: 'create_task',
  async execute({ store, rule, event, context }, config) {
    const company = context.company as { id?: string; csm_id?: string | null } | undefined;
    if (!company?.id) {
      return { type: 'create_task', status: 'skipped', detail: 'sem_empresa_no_evento' };
    }
    const rawTitle = typeof config.title === 'string' ? config.title : '';
    if (!rawTitle.trim()) {
      return { type: 'create_task', status: 'failed', detail: 'titulo_obrigatorio' };
    }
    const severity = SEVERITIES.includes(config.severity as Severity) ? (config.severity as Severity) : 'warn';
    const body = typeof config.body === 'string' ? interpolate(config.body, context).slice(0, 1000) : null;

    const outcome = await store.createTask({
      companyId: company.id,
      csmId: company.csm_id ?? null,
      ruleId: rule.id,
      title: interpolate(rawTitle, context).slice(0, 200),
      body,
      severity,
      dedupeKey: `${rule.id}:${company.id}`
    });
    return { type: 'create_task', status: outcome === 'created' ? 'done' : 'duplicate' };
  }
};

let registered = false;
export function ensureActionsRegistered(): void {
  if (registered) return;
  registerAction(createTaskAction);
  registered = true;
}

export async function runAction(spec: ActionSpec, ctx: ActionCtx): Promise<ActionResult> {
  const executor = getAction(spec.type);
  if (!executor) return { type: spec.type, status: 'failed', detail: 'acao_desconhecida' };
  try {
    return await executor.execute(ctx, spec.config ?? {});
  } catch (err) {
    return { type: spec.type, status: 'failed', detail: err instanceof Error ? err.message : String(err) };
  }
}
