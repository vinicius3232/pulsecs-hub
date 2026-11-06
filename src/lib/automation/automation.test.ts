import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateConditions, interpolate } from './conditions';
import { runAutomationForEvent } from './engine';
import { backoffAt, drainEvents, MAX_ATTEMPTS } from './drain';
import type { ActionResult, AutomationStore, EventRow, NewTask, RuleRow, RunStatus } from './types';

// ---- Store em memória ------------------------------------------------------
function memStore(rules: RuleRow[], company: Record<string, unknown> | null) {
  const tasks: NewTask[] = [];
  const runs: Array<{ ruleId: string; eventId: string; status: RunStatus; actions: ActionResult[] }> = [];
  const store: AutomationStore = {
    async activeRulesFor() { return rules; },
    async companyContext() { return company; },
    async createTask(task) {
      if (task.dedupeKey && tasks.some(x => x.dedupeKey === task.dedupeKey)) return 'duplicate';
      tasks.push(task);
      return 'created';
    },
    async recordRun(run) { runs.push(run); }
  };
  return { store, tasks, runs };
}

const event = (over: Partial<EventRow> = {}): EventRow => ({
  id: 'e1', event_type: 'company.health_changed', entity_kind: 'company', entity_id: 'c1', company_id: 'c1',
  payload: { to: 'red', score_to: 38 }, metadata: {}, external_id: null, status: 'processing', attempts: 1, ...over
});

const riskRule: RuleRow = {
  id: 'r1', name: 'risco',
  conditions: [{ field: 'event.to', op: 'eq', value: 'red' }],
  actions: [{ type: 'create_task', config: { severity: 'critical', title: '{{company.name}} em risco ({{event.score_to}})', body: '{{company.risk_reason}}' } }]
};
const acme = { id: 'c1', name: 'Acme', csm_id: 'u1', risk_reason: 'Sem login', health_score: 38 };

// ---- conditions ------------------------------------------------------------
test('condições: numéricas, eq/neq/contains e campo ausente', () => {
  const ctx = { company: { health_score: 60, tags: ['Google', 'vip'], name: 'Acme Corp' } };
  assert.equal(evaluateConditions([{ field: 'company.health_score', op: 'lt', value: '75' }], ctx), true);
  assert.equal(evaluateConditions([{ field: 'company.health_score', op: 'gte', value: '61' }], ctx), false);
  assert.equal(evaluateConditions([{ field: 'company.tags', op: 'contains', value: 'google' }], ctx), true);
  assert.equal(evaluateConditions([{ field: 'company.name', op: 'contains', value: 'corp' }], ctx), true);
  // ausente: eq/lt falham fechado; neq passa
  assert.equal(evaluateConditions([{ field: 'company.x', op: 'eq', value: 'a' }], ctx), false);
  assert.equal(evaluateConditions([{ field: 'company.x', op: 'lt', value: '5' }], ctx), false);
  assert.equal(evaluateConditions([{ field: 'company.x', op: 'neq', value: 'a' }], ctx), true);
  // valor não numérico não dispara comparação numérica
  assert.equal(evaluateConditions([{ field: 'company.name', op: 'gt', value: '1' }], ctx), false);
  assert.equal(evaluateConditions([], ctx), true);
});

test('interpolate: substitui, usa "—" para ausente e não interpreta HTML', () => {
  assert.equal(interpolate('{{a.b}} e {{a.c}}', { a: { b: 'x' } }), 'x e —');
  assert.equal(interpolate('{{a.b}}', { a: { b: '<img onerror=1>' } }), '<img onerror=1>');
});

// ---- engine ----------------------------------------------------------------
test('engine: regra casa e cria tarefa com texto interpolado e dedupe', async () => {
  const { store, tasks, runs } = memStore([riskRule], acme);
  const r = await runAutomationForEvent(store, event());
  assert.equal(r.status, 'ok');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, 'Acme em risco (38)');
  assert.equal(tasks[0].csmId, 'u1');
  assert.equal(tasks[0].dedupeKey, 'r1:c1');
  assert.equal(runs[0].status, 'success');

  // segundo evento igual: tarefa duplicada não é erro
  await runAutomationForEvent(store, event({ id: 'e2' }));
  assert.equal(tasks.length, 1);
  assert.equal(runs[1].status, 'success');
  assert.equal(runs[1].actions[0].status, 'duplicate');
});

test('engine: condição não casa → nada acontece', async () => {
  const { store, tasks, runs } = memStore([riskRule], acme);
  const r = await runAutomationForEvent(store, event({ payload: { to: 'green' } }));
  assert.equal(r.detail, 'no_match');
  assert.equal(tasks.length + runs.length, 0);
});

test('engine: anti-loop e ação desconhecida/sem empresa não mentem "sucesso"', async () => {
  const a = memStore([riskRule], acme);
  assert.equal((await runAutomationForEvent(a.store, event({ metadata: { caused_by_rule: 'x' } }))).status, 'skipped');

  const b = memStore([{ ...riskRule, actions: [{ type: 'nao_existe' }] }], acme);
  await runAutomationForEvent(b.store, event());
  assert.equal(b.runs[0].status, 'failed');

  const c = memStore([riskRule], null); // empresa não encontrada
  await runAutomationForEvent(c.store, event());
  assert.equal(c.runs[0].status, 'failed'); // skipped conta como não-feito
  assert.equal(c.tasks.length, 0);
});

// ---- drain -----------------------------------------------------------------
type Update = { id: string; patch: Record<string, unknown> };
function fakeAdmin(claimed: EventRow[]) {
  const updates: Update[] = [];
  const admin = {
    rpc: async () => ({ data: claimed, error: null }),
    from: () => ({ update: (patch: Record<string, unknown>) => ({ eq: async (_c: string, id: string) => { updates.push({ id, patch }); return { error: null }; } }) })
  };
  return { admin: admin as never, updates };
}

test('drain: ok → done; erro → retry com backoff; esgotou → dead + tarefa crítica', async () => {
  const { store, tasks } = memStore([], null);
  const now = 1_700_000_000_000;
  const evs = [event({ id: 'ok', attempts: 1 }), event({ id: 'retry', attempts: 2 }), event({ id: 'dead', attempts: MAX_ATTEMPTS })];
  const { admin, updates } = fakeAdmin(evs);
  const handler = async (_s: AutomationStore, e: EventRow) =>
    e.id === 'ok' ? { status: 'ok' as const } : { status: 'error' as const, detail: 'boom' };

  const sum = await drainEvents(admin, store, { handler, now: () => now });
  assert.deepEqual(sum, { scanned: 3, done: 1, retried: 1, dead: 1 });

  const by = Object.fromEntries(updates.map(u => [u.id, u.patch]));
  assert.equal(by.ok.status, 'done');
  assert.equal(by.retry.status, 'pending');
  assert.equal(by.retry.next_attempt_at, backoffAt(2, now)); // 4 min
  assert.equal(by.dead.status, 'dead');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].dedupeKey, 'event_dead');
  assert.equal(tasks[0].severity, 'critical');
});

test('drain: exceção do handler vira retry, não derruba o lote', async () => {
  const { store } = memStore([], null);
  const { admin, updates } = fakeAdmin([event({ id: 'a' }), event({ id: 'b' })]);
  const handler = async (_s: AutomationStore, e: EventRow) => { if (e.id === 'a') throw new Error('x'); return { status: 'ok' as const }; };
  const sum = await drainEvents(admin, store, { handler });
  assert.equal(sum.retried, 1);
  assert.equal(sum.done, 1);
  assert.equal(updates.length, 2);
});
