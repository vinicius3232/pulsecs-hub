// Testes das funções puras do Editor de Regras (sem navegador).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const sandbox = {};
sandbox.globalThis = sandbox;
vm.runInNewContext(readFileSync(fileURLToPath(new URL('./rules-editor.js', import.meta.url)), 'utf8'), sandbox);
const E = sandbox.PulseRulesEditorPure;
const plain = x => JSON.parse(JSON.stringify(x));

test('editor de regras: clonar regra limpa identificadores e prefixa o nome', () => {
  const original = {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Alerta de churn',
    trigger: 'company.health_changed',
    active: true,
    runCount: 42,
    lastRunAt: '2026-11-01T10:00:00Z',
    conditions: [{ field: 'company.health_score', op: 'lt', value: '30' }],
    actions: [{ type: 'create_task', config: { title: 'Ligar para o cliente' } }]
  };

  const clone = E.cloneRule(original);
  assert.equal(clone.name, 'Cópia de Alerta de churn');
  assert.equal(clone.trigger_event, 'company.health_changed');
  assert.equal(clone.is_active, false); // por segurança cópia nasce desativada
  assert.equal(clone.id, undefined);
  assert.equal(clone.runCount, undefined);
  assert.equal(clone.lastRunAt, undefined);
  assert.deepEqual(plain(clone.conditions), original.conditions);
  assert.deepEqual(plain(clone.actions), original.actions);
});

test('editor de regras: validação de estado do formulário no cliente', () => {
  // Vazio
  assert.equal(E.validateEditorState({}).valid, false);

  // Sem nome
  assert.equal(E.validateEditorState({ name: '', trigger_event: 'company.created', actions: [{ type: 'add_note' }] }).valid, false);

  // Sem passos
  assert.equal(E.validateEditorState({ name: 'Regra', trigger_event: 'company.created', actions: [] }).valid, false);

  // Válido
  assert.equal(E.validateEditorState({
    name: 'Boas-vindas',
    trigger_event: 'company.created',
    actions: [{ type: 'create_task', config: { title: 'Onboarding' } }]
  }).valid, true);
});

test('editor de regras: buildRulePayload sanitiza e estrutura payload para a API', () => {
  const rawState = {
    name: '  Regra com Espaços  ',
    trigger_event: 'company.health_changed',
    is_active: 1,
    conditions: [
      { field: ' company.health_score ', op: 'lt', value: ' 50 ' }
    ],
    actions: [
      {
        type: 'create_task',
        config: { title: '  Ação  ', severity: 'critical', body: '  Detalhes  ' }
      },
      {
        type: 'http_request',
        config: { url: 'https://api.test.com', method: 'POST', body: { a: 1 } }
      }
    ]
  };

  const payload = E.buildRulePayload(rawState);
  assert.equal(payload.name, 'Regra com Espaços');
  assert.equal(payload.trigger_event, 'company.health_changed');
  assert.equal(payload.is_active, true);
  assert.deepEqual(plain(payload.conditions), [{ field: 'company.health_score', op: 'lt', value: '50' }]);
  assert.equal(payload.actions[0].type, 'create_task');
  assert.equal(payload.actions[0].config.title, 'Ação');
  assert.equal(payload.actions[0].config.severity, 'critical');
  assert.equal(payload.actions[0].config.body, 'Detalhes');
  assert.equal(payload.actions[1].type, 'http_request');
  assert.equal(payload.actions[1].config.url, 'https://api.test.com');
  assert.deepEqual(plain(payload.actions[1].config.body), { a: 1 });
});
