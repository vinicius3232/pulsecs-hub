// Testes do cálculo do painel "Hoje" (puro, sem navegador).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const sandbox = {};
sandbox.globalThis = sandbox;
vm.runInNewContext(readFileSync(fileURLToPath(new URL('./today.js', import.meta.url)), 'utf8'), sandbox);
const { buildToday, money } = sandbox.PulseTodayPure;
const plain = x => JSON.parse(JSON.stringify(x)); // atravessa o realm do vm

const NOW = new Date('2026-11-06T12:00:00Z');
const daysAgo = n => new Date(NOW.getTime() - n * 86400000).toISOString();
const co = (id, name, status, mrr, extra = {}) => ({ id, uuid: 'u' + id, name, status, mrr, hs: status === 'red' ? 38 : 80, riskFactors: [], riskReason: 'Nenhum', daysToRenewal: 200, ...extra });

test('receita em risco soma só as contas críticas', () => {
  const t = buildToday({ clients: [co(1, 'A', 'red', 8000), co(2, 'B', 'red', 4000), co(3, 'C', 'yellow', 9999), co(4, 'D', 'green', 5000)], tasks: [], now: NOW });
  assert.equal(t.mrrAtRisk, 12000);
  assert.equal(t.criticalCount, 2);
});

test('tarefas: contagem de abertas, críticas e paradas (>= 7 dias)', () => {
  const tasks = [
    { id: 't1', companyUuid: 'u1', title: 'x', severity: 'critical', createdAt: daysAgo(1) },
    { id: 't2', companyUuid: 'u1', title: 'y', severity: 'warn', createdAt: daysAgo(7) },
    { id: 't3', companyUuid: null, title: 'z', severity: 'info', createdAt: daysAgo(30) }
  ];
  const t = buildToday({ clients: [co(1, 'A', 'green', 100)], tasks, now: NOW });
  assert.equal(t.openTasks, 3); assert.equal(t.criticalTasks, 1); assert.equal(t.staleTasks, 2);
});

test('prioridades: críticas antes; empate pelo maior MRR; depois pela mais antiga', () => {
  const clients = [co(1, 'Pequena', 'green', 1000), co(2, 'Grande', 'green', 9000)];
  const tasks = [
    { id: 'a', companyUuid: 'u1', title: 'warn antiga', severity: 'warn', createdAt: daysAgo(20) },
    { id: 'b', companyUuid: 'u1', title: 'crit pequena', severity: 'critical', createdAt: daysAgo(1) },
    { id: 'c', companyUuid: 'u2', title: 'crit grande', severity: 'critical', createdAt: daysAgo(1) }
  ];
  const order = plain(buildToday({ clients, tasks, now: NOW }).priorities.map(p => p.title));
  assert.deepEqual(order, ['crit grande', 'crit pequena', 'warn antiga']);
});

test('conta crítica sem tarefa aberta vira item "sem ação"; com tarefa, não duplica', () => {
  const clients = [co(1, 'Sem tarefa', 'red', 5000, { riskFactors: ['RH ausente há 20 dias'] }), co(2, 'Com tarefa', 'red', 7000)];
  const tasks = [{ id: 't', companyUuid: 'u2', title: 'Ligar', severity: 'critical', createdAt: daysAgo(0) }];
  const t = buildToday({ clients, tasks, now: NOW });
  const sem = t.priorities.filter(p => p.kind === 'account');
  assert.equal(sem.length, 1);
  assert.equal(sem[0].company, 'Sem tarefa');
  assert.equal(sem[0].why, 'RH ausente há 20 dias');
  assert.equal(sem[0].noAction, true);
  assert.equal(t.priorities.filter(p => p.company === 'Com tarefa').length, 1);
});

test('motivo da conta crítica: fator do servidor, senão motivo manual, senão orientação', () => {
  const why = c => buildToday({ clients: [c], tasks: [], now: NOW }).priorities[0].why;
  assert.equal(why(co(1, 'A', 'red', 1, { riskFactors: ['F1'], riskReason: 'manual' })), 'F1');
  assert.equal(why(co(1, 'A', 'red', 1, { riskReason: 'Sem login há 12 dias' })), 'Sem login há 12 dias');
  assert.match(why(co(1, 'A', 'red', 1)), /Raio-X/);
});

test('limite de 12 prioridades e contagem do que ficou de fora', () => {
  const tasks = Array.from({ length: 20 }, (_, i) => ({ id: 't' + i, companyUuid: null, title: 'x' + i, severity: 'warn', createdAt: daysAgo(i) }));
  const t = buildToday({ clients: [], tasks, now: NOW });
  assert.equal(t.priorities.length, 12); assert.equal(t.hiddenPriorities, 8);
});

test('renovações: até 30 dias (inclui vencidas), mais próxima primeiro', () => {
  const clients = [co(1, 'Longe', 'green', 1, { daysToRenewal: 31 }), co(2, 'Vence', 'green', 1, { daysToRenewal: 12 }), co(3, 'Vencida', 'red', 1, { daysToRenewal: -3 }), co(4, 'Sem data', 'green', 1, { daysToRenewal: null })];
  assert.deepEqual(plain(buildToday({ clients, tasks: [], now: NOW }).renewals.map(r => r.company)), ['Vencida', 'Vence']);
});

test('tarefa com severidade desconhecida vira info; estado vazio não quebra', () => {
  const t = buildToday({ clients: [], tasks: [{ id: 'x', companyUuid: null, title: 't', severity: 'bogus', createdAt: NOW.toISOString() }], now: NOW });
  assert.equal(t.priorities[0].severity, 'info');
  const e = buildToday({ clients: [], tasks: [], now: NOW });
  assert.equal(e.priorities.length, 0); assert.equal(e.mrrAtRisk, 0); assert.equal(e.renewals.length, 0);
});

test('money: formatação curta', () => {
  assert.equal(money(0), 'R$ 0'); assert.equal(money(950), 'R$ 950'); assert.equal(money(12400), 'R$ 12.4k'); assert.equal(money(250000), 'R$ 250k');
});
