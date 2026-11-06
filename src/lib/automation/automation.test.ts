import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateConditions, interpolate } from './conditions.js';
import { delayMs, MANUAL_TRIGGER, resumeScheduledStep, runAutomationForEvent } from './engine.js';
import { backoffAt, drainEvents, drainScheduled, MAX_ATTEMPTS } from './drain.js';
import type {
  ActionResult, AutomationStore, EventRow, NewNote, NewScheduledStep, NewTask, RuleRow, RunStatus, ScheduledStep
} from './types.js';

// ---- Store em memória ------------------------------------------------------
function memStore(rules: RuleRow[], company: Record<string, unknown> | null) {
  const tasks: NewTask[] = [];
  const notes: NewNote[] = [];
  const runs = new Map<string, { status: RunStatus; actions: ActionResult[] }>();
  const scheduled: Array<NewScheduledStep & { id: string; status: string; attempts: number }> = [];
  const finished: Array<{ id: string; status: string; error?: string }> = [];
  const retried: Array<{ id: string; resumeAt: string }> = [];
  let companyNow = company;

  const store: AutomationStore = {
    async activeRulesFor(t) { return rules.filter(r => (r as RuleRow & { trigger?: string }).trigger === undefined || (r as RuleRow & { trigger?: string }).trigger === t); },
    async ruleById(id) { return rules.find(r => r.id === id) ?? null; },
    async companyContext() { return companyNow; },
    async createTask(task) {
      if (task.dedupeKey && tasks.some(x => x.dedupeKey === task.dedupeKey)) return 'duplicate';
      tasks.push(task);
      return 'created';
    },
    async addNote(n) { notes.push(n); },
    async recordRun(run) { runs.set(`${run.ruleId}:${run.eventId}`, { status: run.status, actions: run.actions.map(a => ({ ...a })) }); },
    async getRunActions(ruleId, eventId) { return (runs.get(`${ruleId}:${eventId}`)?.actions ?? []).map(a => ({ ...a })); },
    async scheduleResume(s) {
      if (scheduled.some(x => x.ruleId === s.ruleId && x.eventId === s.eventId && x.nextIndex === s.nextIndex)) return 'duplicate';
      scheduled.push({ ...s, id: `s${scheduled.length + 1}`, status: 'pending', attempts: 0 });
      return 'scheduled';
    },
    async claimDueScheduled() {
      return scheduled.filter(s => s.status === 'pending').map(s => ({
        id: s.id, rule_id: s.ruleId, event_id: s.eventId, company_id: s.companyId, event_type: s.eventType,
        payload: s.payload, next_index: s.nextIndex, attempts: s.attempts + 1
      } as ScheduledStep));
    },
    async finishScheduled(id, status, error) { finished.push({ id, status, error }); const s = scheduled.find(x => x.id === id); if (s) s.status = status; },
    async retryScheduled(id, resumeAt) { retried.push({ id, resumeAt }); }
  };
  return { store, tasks, notes, runs, scheduled, finished, retried, setCompany: (c: Record<string, unknown> | null) => { companyNow = c; } };
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
const acme = { id: 'c1', name: 'Acme', csm_id: 'u1', risk_reason: 'Sem login', health_score: 38, phase: 'Config & Carga' };

// ---- conditions ------------------------------------------------------------
test('condições: numéricas, eq/neq/contains e campo ausente', () => {
  const ctx = { company: { health_score: 60, tags: ['Google', 'vip'], name: 'Acme Corp' } };
  assert.equal(evaluateConditions([{ field: 'company.health_score', op: 'lt', value: '75' }], ctx), true);
  assert.equal(evaluateConditions([{ field: 'company.health_score', op: 'gte', value: '61' }], ctx), false);
  assert.equal(evaluateConditions([{ field: 'company.tags', op: 'contains', value: 'google' }], ctx), true);
  assert.equal(evaluateConditions([{ field: 'company.name', op: 'contains', value: 'corp' }], ctx), true);
  assert.equal(evaluateConditions([{ field: 'company.x', op: 'eq', value: 'a' }], ctx), false);
  assert.equal(evaluateConditions([{ field: 'company.x', op: 'lt', value: '5' }], ctx), false);
  assert.equal(evaluateConditions([{ field: 'company.x', op: 'neq', value: 'a' }], ctx), true);
  assert.equal(evaluateConditions([{ field: 'company.name', op: 'gt', value: '1' }], ctx), false);
  assert.equal(evaluateConditions([], ctx), true);
});

test('interpolate: substitui, usa "—" para ausente e não interpreta HTML', () => {
  assert.equal(interpolate('{{a.b}} e {{a.c}}', { a: { b: 'x' } }), 'x e —');
  assert.equal(interpolate('{{a.b}}', { a: { b: '<img onerror=1>' } }), '<img onerror=1>');
});

// ---- engine básico ---------------------------------------------------------
test('engine: regra casa e cria tarefa com texto interpolado e dedupe', async () => {
  const m = memStore([riskRule], acme);
  const r = await runAutomationForEvent(m.store, event());
  assert.equal(r.status, 'ok');
  assert.equal(m.tasks.length, 1);
  assert.equal(m.tasks[0].title, 'Acme em risco (38)');
  assert.equal(m.tasks[0].dedupeKey, 'r1:c1');
  assert.equal(m.runs.get('r1:e1')?.status, 'success');

  await runAutomationForEvent(m.store, event({ id: 'e2' }));
  assert.equal(m.tasks.length, 1);
  assert.equal(m.runs.get('r1:e2')?.actions[0].status, 'duplicate');
  assert.equal(m.runs.get('r1:e2')?.status, 'success');
});

test('engine: condição não casa; anti-loop; ação desconhecida e empresa ausente não mentem "sucesso"', async () => {
  const a = memStore([riskRule], acme);
  assert.equal((await runAutomationForEvent(a.store, event({ payload: { to: 'green' } }))).detail, 'no_match');
  assert.equal((await runAutomationForEvent(a.store, event({ metadata: { caused_by_rule: 'x' } }))).status, 'skipped');

  const b = memStore([{ ...riskRule, actions: [{ type: 'nao_existe' }] }], acme);
  await runAutomationForEvent(b.store, event());
  assert.equal(b.runs.get('r1:e1')?.status, 'failed');

  const c = memStore([riskRule], null);
  await runAutomationForEvent(c.store, event());
  assert.equal(c.runs.get('r1:e1')?.status, 'failed');
  assert.equal(c.tasks.length, 0);
});

// ---- if/else ---------------------------------------------------------------
const ifRule = (then: unknown[], els: unknown[] = []): RuleRow => ({
  id: 'r2', name: 'if', conditions: [],
  actions: [{ type: 'if', config: { conditions: [{ field: 'company.health_score', op: 'lt', value: '50' }], then, else: els } as never }]
});

test('if/else: executa só o ramo escolhido', async () => {
  const task = (t: string) => ({ type: 'create_task', config: { title: t } });
  const low = memStore([ifRule([task('baixo')], [task('ok')])], { ...acme, health_score: 30 });
  await runAutomationForEvent(low.store, event());
  assert.deepEqual(low.tasks.map(t => t.title), ['baixo']);
  assert.equal(low.runs.get('r2:e1')?.actions[0].detail, 'then');

  const high = memStore([ifRule([task('baixo')], [task('ok')])], { ...acme, health_score: 90 });
  await runAutomationForEvent(high.store, event());
  assert.deepEqual(high.tasks.map(t => t.title), ['ok']);
});

test('if/else: delay dentro de ramo é recusado, if aninhado funciona', async () => {
  const m = memStore([ifRule([{ type: 'delay', config: { days: 1 } }, { type: 'add_note', config: { content: 'n' } }])], { ...acme, health_score: 10 });
  await runAutomationForEvent(m.store, event());
  const acts = m.runs.get('r2:e1')!.actions;
  assert.equal(acts.find(a => a.type === 'delay')?.detail, 'delay_nao_permitido_em_ramo');
  assert.equal(m.scheduled.length, 0);
  assert.equal(m.notes.length, 1);

  const nested = ifRule([{ type: 'if', config: { conditions: [], then: [{ type: 'add_note', config: { content: 'fundo' } }] } }]);
  const n = memStore([nested], { ...acme, health_score: 10 });
  await runAutomationForEvent(n.store, event());
  assert.equal(n.notes[0].content, 'fundo');
});

// ---- delay -----------------------------------------------------------------
test('delayMs: valida limites', () => {
  assert.equal(delayMs({ days: 1 }), 86_400_000);
  assert.equal(delayMs({ days: 1, hours: 12 }), 129_600_000);
  assert.equal(delayMs({ days: 0 }), null);
  assert.equal(delayMs({ days: -1 }), null);
  assert.equal(delayMs({ days: 91 }), null);
  assert.equal(delayMs({ days: 'x' as never }), null);
});

const delayRule: RuleRow = {
  id: 'r3', name: 'delay', conditions: [],
  actions: [
    { type: 'add_note', config: { content: 'antes' } },
    { type: 'delay', config: { days: 7 } },
    { type: 'if', config: { conditions: [{ field: 'company.phase', op: 'eq', value: 'Config & Carga' }], then: [{ type: 'create_task', config: { title: 'parado {{company.name}}' } }], else: [] } }
  ]
};

test('delay: executa antes, agenda e para; retoma depois e conclui o mesmo registro', async () => {
  const now = 1_700_000_000_000;
  const m = memStore([delayRule], acme);
  await runAutomationForEvent(m.store, event(), { now: () => now });

  assert.equal(m.notes.length, 1);                       // passo antes do delay rodou
  assert.equal(m.tasks.length, 0);                        // o depois não
  assert.equal(m.scheduled.length, 1);
  assert.equal(m.scheduled[0].nextIndex, 2);
  assert.equal(m.scheduled[0].resumeAt, new Date(now + 7 * 86_400_000).toISOString());
  assert.equal(m.runs.get('r3:e1')?.status, 'waiting');

  // reprocessar o mesmo evento não duplica a espera
  assert.equal(await m.store.scheduleResume({ ...m.scheduled[0] }), 'duplicate');

  // dias depois: a empresa continua na mesma fase → cria a tarefa
  const drained = await drainScheduled(m.store, { now: () => now + 8 * 86_400_000 });
  assert.deepEqual(drained, { scanned: 1, resumed: 1, cancelled: 0, retried: 0, failed: 0 });
  assert.equal(m.tasks[0].title, 'parado Acme');
  const run = m.runs.get('r3:e1')!;
  assert.equal(run.status, 'success');
  assert.equal(run.actions.find(a => a.type === 'delay')?.status, 'done');
  assert.equal(m.finished[0].status, 'done');
});

test('delay: na retomada o contexto é refeito (empresa avançou de fase → ramo else, nada a fazer)', async () => {
  const m = memStore([delayRule], acme);
  await runAutomationForEvent(m.store, event());
  m.setCompany({ ...acme, phase: 'Go-Live' });
  await drainScheduled(m.store);
  assert.equal(m.tasks.length, 0);
});

test('delay: regra desativada ou removida cancela a espera', async () => {
  const m = memStore([delayRule], acme);
  await runAutomationForEvent(m.store, event());
  delayRule.is_active = false;
  try {
    const step = (await m.store.claimDueScheduled(10))[0];
    assert.equal(await resumeScheduledStep(m.store, step), 'cancelled');
    assert.equal(m.finished.at(-1)?.status, 'cancelled');
  } finally {
    delete delayRule.is_active;
  }
});

test('delay inválido vira falha visível e não agenda nada', async () => {
  const bad: RuleRow = { id: 'r4', name: 'bad', conditions: [], actions: [{ type: 'delay', config: { days: 400 } }, { type: 'add_note', config: { content: 'x' } }] };
  const m = memStore([bad], acme);
  await runAutomationForEvent(m.store, event());
  assert.equal(m.scheduled.length, 0);
  assert.equal(m.notes.length, 0);
  assert.equal(m.runs.get('r4:e1')?.status, 'failed');
});

test('drainScheduled: erro ao retomar → retry com backoff; esgotou → failed', async () => {
  const m = memStore([delayRule], acme);
  await runAutomationForEvent(m.store, event());
  m.store.ruleById = async () => { throw new Error('banco fora'); };
  const now = 1_700_000_000_000;
  const a = await drainScheduled(m.store, { now: () => now });
  assert.equal(a.retried, 1);
  assert.equal(m.retried[0].resumeAt, backoffAt(1, now));

  m.scheduled[0].attempts = MAX_ATTEMPTS; // claim devolve attempts+1 > MAX
  const b = await drainScheduled(m.store, { now: () => now });
  assert.equal(b.failed, 1);
});

// ---- gatilho manual --------------------------------------------------------
test('manual.run: só a regra apontada em payload.rule_id executa', async () => {
  const mk = (id: string): RuleRow & { trigger: string } => ({ id, name: id, trigger: MANUAL_TRIGGER, conditions: [], actions: [{ type: 'add_note', config: { content: id } }] });
  const m = memStore([mk('ra'), mk('rb')], acme);
  await runAutomationForEvent(m.store, event({ event_type: MANUAL_TRIGGER, payload: { rule_id: 'rb' } }));
  assert.deepEqual(m.notes.map(n => n.content), ['rb']);
  const none = memStore([mk('ra')], acme);
  assert.equal((await runAutomationForEvent(none.store, event({ event_type: MANUAL_TRIGGER, payload: { rule_id: 'zzz' } }))).detail, 'no_rules');
});

// ---- add_note / http_request ----------------------------------------------
test('add_note: interpola e exige empresa', async () => {
  const rule: RuleRow = { id: 'rn', name: 'n', conditions: [], actions: [{ type: 'add_note', config: { content: 'Score {{company.health_score}}' } }] };
  const m = memStore([rule], acme);
  await runAutomationForEvent(m.store, event());
  assert.deepEqual(m.notes[0], { companyId: 'c1', csmId: 'u1', content: 'Score 38' });
  const sem = memStore([rule], null);
  await runAutomationForEvent(sem.store, event());
  assert.equal(sem.runs.get('rn:e1')?.status, 'failed');
});

test('http_request: SSRF — só https, sem IP/localhost/credenciais, host na allowlist', async () => {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: unknown) => { calls.push(String(u)); return new Response('ok', { status: 200 }); }) as typeof fetch;
  process.env.AUTOMATION_HTTP_ALLOWLIST = 'hooks.exemplo.com, outro.com';
  try {
    const run = async (url: string) => {
      const m = memStore([{ id: 'rh', name: 'h', conditions: [], actions: [{ type: 'http_request', config: { url } }] }], acme);
      await runAutomationForEvent(m.store, event());
      return m.runs.get('rh:e1')!.actions[0];
    };
    assert.equal((await run('https://hooks.exemplo.com/x')).status, 'done');
    assert.equal(calls.length, 1);
    for (const [url, why] of [
      ['http://hooks.exemplo.com/x', 'somente_https'],
      ['https://evil.com/x', 'host_fora_da_allowlist'],
      ['https://127.0.0.1/x', 'host_nao_permitido'],
      ['https://localhost/x', 'host_nao_permitido'],
      ['https://[::1]/x', 'host_nao_permitido'],
      ['https://u:p@hooks.exemplo.com/x', 'credenciais_na_url'],
      ['nao-e-url', 'url_invalida']
    ]) {
      const r = await run(url);
      assert.equal(r.status, 'failed', url);
      assert.equal(r.detail, why, url);
    }
    assert.equal(calls.length, 1); // nenhuma chamada extra saiu

    delete process.env.AUTOMATION_HTTP_ALLOWLIST; // vazia = nega tudo
    assert.equal((await run('https://hooks.exemplo.com/x')).detail, 'host_fora_da_allowlist');
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.AUTOMATION_HTTP_ALLOWLIST;
  }
});

// ---- drain de eventos ------------------------------------------------------
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
  const m = memStore([], null);
  const now = 1_700_000_000_000;
  const evs = [event({ id: 'ok', attempts: 1 }), event({ id: 'retry', attempts: 2 }), event({ id: 'dead', attempts: MAX_ATTEMPTS })];
  const { admin, updates } = fakeAdmin(evs);
  const handler = async (_s: AutomationStore, e: EventRow) =>
    e.id === 'ok' ? { status: 'ok' as const } : { status: 'error' as const, detail: 'boom' };

  const sum = await drainEvents(admin, m.store, { handler, now: () => now });
  assert.deepEqual(sum, { scanned: 3, done: 1, retried: 1, dead: 1 });
  const by = Object.fromEntries(updates.map(u => [u.id, u.patch]));
  assert.equal(by.ok.status, 'done');
  assert.equal(by.retry.status, 'pending');
  assert.equal(by.retry.next_attempt_at, backoffAt(2, now));
  assert.equal(by.dead.status, 'dead');
  assert.equal(m.tasks[0].dedupeKey, 'event_dead');
  assert.equal(m.tasks[0].severity, 'critical');
});

test('drain: exceção do handler vira retry, não derruba o lote', async () => {
  const m = memStore([], null);
  const { admin, updates } = fakeAdmin([event({ id: 'a' }), event({ id: 'b' })]);
  const handler = async (_s: AutomationStore, e: EventRow) => { if (e.id === 'a') throw new Error('x'); return { status: 'ok' as const }; };
  const sum = await drainEvents(admin, m.store, { handler });
  assert.equal(sum.retried, 1);
  assert.equal(sum.done, 1);
  assert.equal(updates.length, 2);
});

// ---- recuperação: queda entre "executar" e "confirmar" ----------------------
test('RECUPERAÇÃO: processo cai depois de executar a regra e antes de marcar o evento como feito', async () => {
  const m = memStore([riskRule], acme);
  const ev = event({ id: 'crash', attempts: 1 });
  // 1ª passada: o motor roda (cria tarefa e registra a execução) e o processo "morre" antes de confirmar
  const quebraDepois = async (s: AutomationStore, e: EventRow) => { await runAutomationForEvent(s, e); throw new Error('processo morreu'); };
  const a = fakeAdmin([ev]);
  const s1 = await drainEvents(a.admin, m.store, { handler: quebraDepois });
  assert.equal(s1.retried, 1);
  assert.equal(a.updates[0].patch.status, 'pending');
  // 2ª passada: o evento volta (backoff) e é reprocessado de verdade
  const b = fakeAdmin([{ ...ev, attempts: 2 }]);
  const s2 = await drainEvents(b.admin, m.store);
  assert.equal(s2.done, 1);
  assert.equal(b.updates[0].patch.status, 'done');
  // nada duplicou: 1 tarefa, 1 registro de execução
  assert.equal(m.tasks.length, 1);
  assert.equal([...m.runs.keys()].filter(k => k.endsWith(':crash')).length, 1);
});

test('RECUPERAÇÃO: queda logo depois de agendar um delay não duplica a espera no reprocesso', async () => {
  const m = memStore([delayRule], acme);
  const ev = event({ id: 'crash2' });
  const quebraDepois = async (s: AutomationStore, e: EventRow) => { await runAutomationForEvent(s, e); throw new Error('processo morreu'); };
  await drainEvents(fakeAdmin([ev]).admin, m.store, { handler: quebraDepois });
  await drainEvents(fakeAdmin([{ ...ev, attempts: 2 }]).admin, m.store);
  assert.equal(m.scheduled.length, 1);          // UNIQUE (regra, evento, passo)
  assert.equal(m.runs.get('r3:crash2')?.status, 'waiting');
});

test('RECUPERAÇÃO: queda ao concluir uma espera: tarefa não duplica; passos sem idempotência podem repetir (limitação conhecida)', async () => {
  const rule: RuleRow = { id: 'r9', name: 'x', conditions: [], actions: [
    { type: 'delay', config: { days: 1 } },
    { type: 'create_task', config: { title: 'checar' } },
    { type: 'add_note', config: { content: 'nota' } }
  ] };
  const m = memStore([rule], acme);
  await runAutomationForEvent(m.store, event({ id: 'e9' }), { now: () => 0 });
  // a 1ª tentativa de confirmar a espera cai
  const original = m.store.finishScheduled;
  let caiu = false;
  m.store.finishScheduled = async (...args) => { if (!caiu) { caiu = true; throw new Error('queda ao confirmar'); } return original(...args); };
  const s1 = await drainScheduled(m.store, { now: () => 0 });
  assert.equal(s1.retried, 1);
  const s2 = await drainScheduled(m.store, { now: () => 0 });
  assert.equal(s2.resumed, 1);
  assert.equal(m.tasks.length, 1);          // dedupe da tarefa
  assert.equal(m.notes.length, 2);          // at-least-once: a nota repete (add_note não é idempotente)
  assert.equal(m.runs.get('r9:e9')?.status, 'success');
});
