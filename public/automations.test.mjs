// Testes da descrição legível das regras de automação (puro, sem navegador).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const sandbox = { URL }; // o navegador tem URL; o contexto vm vazio não
sandbox.globalThis = sandbox;
vm.runInNewContext(readFileSync(fileURLToPath(new URL('./automations.js', import.meta.url)), 'utf8'), sandbox);
const A = sandbox.PulseAutomationsPure;
const plain = x => JSON.parse(JSON.stringify(x));

test('gatilhos e condições em português; desconhecidos aparecem como estão', () => {
  assert.equal(A.triggerLabel('company.phase_changed'), 'Fase da empresa mudou');
  assert.equal(A.triggerLabel('company.outro'), 'company.outro');
  assert.equal(A.describeCondition({ field: 'company.health_score', op: 'lt', value: '75' }), 'score < 75');
  assert.equal(A.describeCondition({ field: 'x.y', op: 'zzz', value: 'a' }), 'x.y zzz a');
  assert.equal(A.describeConditions([]), 'sempre');
  assert.equal(A.describeConditions([{ field: 'event.to', op: 'eq', value: 'red' }, { field: 'company.phase', op: 'neq', value: 'Go-Live' }]), 'novo valor = red e fase ≠ Go-Live');
});

test('passos: criar tarefa, nota, delay, http (só o host) e passo desconhecido', () => {
  assert.equal(A.describeStep({ type: 'create_task', config: { severity: 'critical', title: 'Ligar' } }), 'Criar tarefa (crítica): "Ligar"');
  assert.equal(A.describeStep({ type: 'create_task', config: { title: 'x' } }), 'Criar tarefa (atenção): "x"');
  assert.match(A.describeStep({ type: 'add_note', config: { content: 'n' } }), /Registrar nota/);
  assert.equal(A.describeStep({ type: 'delay', config: { days: 7 } }), 'Aguardar 7 dias');
  assert.equal(A.describeStep({ type: 'delay', config: { days: 1, hours: 12 } }), 'Aguardar 1 dia e 12 horas');
  assert.equal(A.describeStep({ type: 'delay', config: {} }), 'Aguardar tempo inválido');
  const http = A.describeStep({ type: 'http_request', config: { url: 'https://hooks.exemplo.com/secreto/abc?token=123', method: 'POST' } });
  assert.equal(http, 'Chamar hooks.exemplo.com (POST)');
  assert.ok(!http.includes('secreto') && !http.includes('token')); // caminho e token da URL não aparecem na tela
  assert.equal(A.describeStep({ type: 'http_request', config: { url: 'lixo' } }), 'Chamar endereço inválido (POST)');
  assert.match(A.describeStep({ type: 'teleport' }), /desconhecido/);
  assert.equal(A.describeStep(null), '?');
});

test('if/else aninhado vira uma frase; profundidade limitada', () => {
  const step = { type: 'if', config: { conditions: [{ field: 'company.phase', op: 'eq', value: 'Config & Carga' }], then: [{ type: 'create_task', config: { title: 'T' } }, { type: 'add_note', config: { content: 'N' } }], else: [{ type: 'add_note', config: { content: 'E' } }] } };
  const s = A.describeStep(step);
  assert.match(s, /^Se fase = Config & Carga: Criar tarefa/);
  assert.match(s, /· senão: Registrar nota/);
  let deep = { type: 'create_task', config: { title: 'fundo' } };
  for (let i = 0; i < 6; i++) deep = { type: 'if', config: { conditions: [], then: [deep] } };
  assert.ok(A.describeStep(deep).length < 400);
});

test('describeSteps numera; lista inválida vira vazia', () => {
  assert.deepEqual(plain(A.describeSteps([{ type: 'delay', config: { days: 2 } }, { type: 'add_note', config: { content: 'a' } }])).map(x => x.slice(0, 3)), ['1. ', '2. ']);
  assert.deepEqual(plain(A.describeSteps(null)), []);
});

test('mapRule higieniza o que vem do banco', () => {
  const r = A.mapRule({ id: 'r', name: 'N', trigger_event: 'manual.run', is_active: 1, conditions: null, actions: 'x', run_count: '3', last_run_at: null });
  assert.equal(r.active, true); assert.deepEqual(plain(r.conditions), []); assert.deepEqual(plain(r.actions), []); assert.equal(r.runCount, 3); assert.equal(r.lastRunAt, null);
});

test('rótulos de status de execução cobrem todos os estados do banco', () => {
  for (const s of ['success', 'partial', 'failed', 'waiting']) assert.ok(A.RUN_STATUS[s].label);
});
