import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBatch, parseMetricsItem, MAX_ITEMS } from './ingest.js';

const ID = 'c0000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-11-06T12:00:00Z');

test('item válido por company_id e por cnpj (com máscara)', () => {
  const a = parseMetricsItem({ company_id: ID.toUpperCase(), eligible_lives: 1000, active_lives: 800, mau_lives: 600, total_savings: 1234.567, nps_score: 8.44, has_overdue_invoice: false, last_login_at: '2026-11-05T10:00:00Z' }, NOW);
  assert.ok(a.ok);
  if (a.ok) {
    assert.deepEqual(a.target, { kind: 'id', value: ID });
    assert.equal(a.patch.total_savings, 1234.57);
    assert.equal(a.patch.nps_score, 8.4);
    assert.equal(a.patch.last_login_at, '2026-11-05T10:00:00.000Z');
  }
  const b = parseMetricsItem({ cnpj: '12.345.678/0001-90', active_lives: 5 }, NOW);
  assert.ok(b.ok && b.target.kind === 'cnpj' && b.target.value === '12345678000190');

  const c = parseMetricsItem({ platform_id: 'empresa_externa_123', active_lives: 50 }, NOW);
  assert.ok(c.ok && c.target.kind === 'platform_id' && c.target.value === 'empresa_externa_123');

  const d = parseMetricsItem({ external_id: 'ext_999', eligible_lives: 100, active_lives: 80 }, NOW);
  assert.ok(d.ok && d.target.kind === 'platform_id' && d.target.value === 'ext_999');
});

test('só chaves conhecidas chegam ao patch (mass assignment bloqueado)', () => {
  const r = parseMetricsItem({ company_id: ID, active_lives: 1, health_score: 100, health_status: 'green', csm_id: 'x', mrr: 999999, name: 'hack', id: 'y' }, NOW);
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(Object.keys(r.patch), ['active_lives']);
});

test('recusa alvo ausente/inválido e itens que não são objetos', () => {
  for (const [raw, why] of [
    [null, /objeto/], [[], /objeto/], ['x', /objeto/],
    [{ active_lives: 1 }, /company_id, cnpj ou platform_id/],
    [{ company_id: 'nao-uuid', active_lives: 1 }, /company_id inválido/],
    [{ cnpj: '123', active_lives: 1 }, /14 dígitos/],
    [{ platform_id: '', active_lives: 1 }, /platform_id deve ter/],
    [{ company_id: ID }, /nenhuma métrica/]
  ] as const) {
    const r = parseMetricsItem(raw, NOW);
    assert.ok(!r.ok); if (!r.ok) assert.match(r.reason, why as RegExp);
  }
});

test('recusa números inválidos', () => {
  const bad: Array<Record<string, unknown>> = [
    { eligible_lives: -1 }, { eligible_lives: 1.5 }, { eligible_lives: '10' }, { active_lives: 1e9 }, { mau_lives: NaN },
    { total_savings: -0.01 }, { total_savings: Infinity }, { total_savings: '5' },
    { nps_score: 11 }, { nps_score: -1 }, { nps_score: 'a' },
    { has_overdue_invoice: 'true' }, { has_overdue_invoice: 1 },
    { last_login_at: 'ontem' }, { last_login_at: 123 }, { last_login_at: '2026-12-31T00:00:00Z' }
  ];
  for (const b of bad) assert.ok(!parseMetricsItem({ company_id: ID, ...b }, NOW).ok, JSON.stringify(b));
});

test('nps null limpa o NPS; zero é válido', () => {
  const r = parseMetricsItem({ company_id: ID, nps_score: null, eligible_lives: 0 }, NOW);
  assert.ok(r.ok); if (r.ok) { assert.equal(r.patch.nps_score, null); assert.equal(r.patch.eligible_lives, 0); }
});

test('lote: formato, vazio e limite', () => {
  assert.ok(!parseBatch(null).ok);
  assert.ok(!parseBatch({}).ok);
  assert.ok(!parseBatch({ items: 'x' }).ok);
  assert.ok(!parseBatch({ items: [] }).ok);
  assert.ok(parseBatch({ items: [{}] }).ok);
  assert.ok(parseBatch({ items: new Array(MAX_ITEMS).fill({}) }).ok);
  assert.ok(!parseBatch({ items: new Array(MAX_ITEMS + 1).fill({}) }).ok);
});
