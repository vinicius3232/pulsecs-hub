import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkQueueHealthAlert, formatHealthAge, systemHealthStatus } from './health-alert.js';

test('health-alert: fila saudável não gera alerta', () => {
  const stats = {
    pendingEvents: 5,
    oldestAgeSeconds: 120,
    deadEvents: 0
  };

  const res = checkQueueHealthAlert(stats);
  assert.equal(res.alert, false);
  assert.equal(res.severity, null);
  assert.equal(res.reasons.length, 0);
  assert.equal(res.taskTitle, null);
  assert.equal(systemHealthStatus(stats), 'green');
});

test('health-alert: alerta quando eventos pendentes ultrapassam o limite configurável', () => {
  const stats = {
    pendingEvents: 60, // padrão é 50
    oldestAgeSeconds: 300,
    deadEvents: 0
  };

  const res = checkQueueHealthAlert(stats);
  assert.equal(res.alert, true);
  assert.equal(res.severity, 'critical');
  assert.match(res.reasons[0], /60 itens pendentes/);
  assert.match(res.taskTitle ?? '', /\[Alerta de Sistema\]/);
  assert.equal(systemHealthStatus(stats), 'red');

  // Com limite customizado mais alto (ex.: 100), não deve disparar
  const custom = checkQueueHealthAlert(stats, { maxPending: 100 });
  assert.equal(custom.alert, false);
});

test('health-alert: alerta quando atraso ultrapassa o limite configurável', () => {
  const stats = {
    pendingEvents: 2,
    oldestAgeSeconds: 4000, // limite default: 3600s
    deadEvents: 0
  };

  const res = checkQueueHealthAlert(stats);
  assert.equal(res.alert, true);
  assert.equal(res.severity, 'warn');
  assert.match(res.reasons[0], /Atraso de processamento/);

  // Sem eventos pendentes, idade alta não gera alarme falso
  const emptyQueue = checkQueueHealthAlert({ pendingEvents: 0, oldestAgeSeconds: 5000, deadEvents: 0 });
  assert.equal(emptyQueue.alert, false);
});

test('health-alert: eventos mortos (dead) geram alerta crítico imediato', () => {
  const stats = {
    pendingEvents: 1,
    oldestAgeSeconds: 60,
    deadEvents: 3
  };

  const res = checkQueueHealthAlert(stats);
  assert.equal(res.alert, true);
  assert.equal(res.severity, 'critical');
  assert.match(res.reasons[0], /3 evento\(s\) mortos/);
});

test('health-alert: formatação legível de atraso', () => {
  assert.equal(formatHealthAge(0), '0s');
  assert.equal(formatHealthAge(45), '45s');
  assert.equal(formatHealthAge(300), '5 min');
  assert.equal(formatHealthAge(3600), '1h');
  assert.equal(formatHealthAge(3720), '1h 2min');
});
