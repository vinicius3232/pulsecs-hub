import { evaluateConditions, interpolate } from './conditions.js';
import type { ActionResult, ActionSpec, AutomationStore, EventRow, RuleCondition, RuleRow, Severity } from './types.js';

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
  async execute({ store, rule, context }, config) {
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

/** Registra uma nota na linha do tempo do cliente (tabela interactions, canal "note"). */
export const addNoteAction: ActionExecutor = {
  type: 'add_note',
  async execute({ store, context }, config) {
    const company = context.company as { id?: string; csm_id?: string | null } | undefined;
    if (!company?.id) return { type: 'add_note', status: 'skipped', detail: 'sem_empresa_no_evento' };
    const raw = typeof config.content === 'string' ? config.content : '';
    if (!raw.trim()) return { type: 'add_note', status: 'failed', detail: 'conteudo_obrigatorio' };
    await store.addNote({
      companyId: company.id,
      csmId: company.csm_id ?? null,
      content: interpolate(raw, context).slice(0, 2000)
    });
    return { type: 'add_note', status: 'done' };
  }
};

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Hosts permitidos para http_request (env AUTOMATION_HTTP_ALLOWLIST, separados por vírgula). */
export function allowedHttpHosts(): string[] {
  return (process.env.AUTOMATION_HTTP_ALLOWLIST || '')
    .split(',')
    .map(h => h.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Chamada HTTP de saída. Defesa contra SSRF: HTTPS, sem credenciais na URL, sem IP literal
 * nem localhost, e o host precisa estar na allowlist (falha fechada se vazia).
 * Não segue redirecionamentos e não guarda o corpo da resposta.
 */
export const httpRequestAction: ActionExecutor = {
  type: 'http_request',
  async execute({ context }, config) {
    const rawUrl = typeof config.url === 'string' ? interpolate(config.url, context) : '';
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return { type: 'http_request', status: 'failed', detail: 'url_invalida' };
    }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:') return { type: 'http_request', status: 'failed', detail: 'somente_https' };
    if (url.username || url.password) return { type: 'http_request', status: 'failed', detail: 'credenciais_na_url' };
    if (IPV4.test(host) || host.includes(':') || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
      return { type: 'http_request', status: 'failed', detail: 'host_nao_permitido' };
    }
    if (!allowedHttpHosts().includes(host)) {
      return { type: 'http_request', status: 'failed', detail: 'host_fora_da_allowlist' };
    }

    const method = config.method === 'GET' ? 'GET' : 'POST';
    let body: string | undefined;
    if (method === 'POST') {
      const b = config.body;
      body = typeof b === 'string' ? interpolate(b, context) : JSON.stringify(b ?? { company: context.company ?? null, event: context.event });
    }
    try {
      const res = await fetch(url, {
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body
      });
      return { type: 'http_request', status: res.ok ? 'done' : 'failed', detail: `http_${res.status}` };
    } catch (err) {
      return { type: 'http_request', status: 'failed', detail: (err as Error)?.name === 'TimeoutError' ? 'timeout' : 'erro_de_rede' };
    }
  }
};

let registered = false;
export function ensureActionsRegistered(): void {
  if (registered) return;
  registerAction(createTaskAction);
  registerAction(addNoteAction);
  registerAction(httpRequestAction);
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

const MAX_BRANCH_DEPTH = 5;

/**
 * Executa os passos de um ramo do `if` (recursivo). `delay` não é permitido aqui:
 * a retomada precisa de um ponto único na lista raiz.
 */
export async function runBranch(steps: ActionSpec[], ctx: ActionCtx, depth = 0): Promise<ActionResult[]> {
  const out: ActionResult[] = [];
  for (const step of steps) {
    if (step.type === 'delay') {
      out.push({ type: 'delay', status: 'failed', detail: 'delay_nao_permitido_em_ramo' });
    } else if (step.type === 'if') {
      out.push(...(await runIf(step, ctx, depth + 1)));
    } else {
      out.push(await runAction(step, ctx));
    }
  }
  return out;
}

export async function runIf(step: ActionSpec, ctx: ActionCtx, depth = 0): Promise<ActionResult[]> {
  if (depth > MAX_BRANCH_DEPTH) return [{ type: 'if', status: 'failed', detail: 'profundidade_maxima' }];
  const cfg = (step.config ?? {}) as { conditions?: RuleCondition[]; then?: ActionSpec[]; else?: ActionSpec[] };
  const ok = evaluateConditions(Array.isArray(cfg.conditions) ? cfg.conditions : [], ctx.context);
  const branch = ok ? cfg.then : cfg.else;
  const results: ActionResult[] = [{ type: 'if', status: 'done', detail: ok ? 'then' : 'else' }];
  if (Array.isArray(branch) && branch.length) results.push(...(await runBranch(branch, ctx, depth)));
  return results;
}
