import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { _resetLocal, rateLimited, rateLimitedLocal } from './ratelimit.js';

beforeEach(() => _resetLocal());

const ENV = { UPSTASH_REDIS_REST_URL: 'https://redis.example.io/', UPSTASH_REDIS_REST_TOKEN: 'tok' };

/** Redis simulado: INCR por chave e resposta no formato do pipeline do Upstash. */
function fakeRedis() {
  const counters = new Map<string, number>();
  const calls: Array<{ url: string; auth: string; cmds: string[][] }> = [];
  const fetchImpl = async (url: string, init: { headers: Record<string, string>; body: string }) => {
    const cmds = JSON.parse(init.body) as string[][];
    calls.push({ url, auth: init.headers.Authorization, cmds });
    const key = cmds[0][1];
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    return { ok: true, json: async () => [{ result: n }, { result: 1 }] };
  };
  return { fetchImpl, counters, calls };
}

test('local: libera até o máximo e bloqueia depois; a janela expira', () => {
  const t0 = 1_700_000_000_000;
  for (let i = 0; i < 3; i++) assert.equal(rateLimitedLocal('k', 3, 1000, t0 + i), false);
  assert.equal(rateLimitedLocal('k', 3, 1000, t0 + 10), true);
  assert.equal(rateLimitedLocal('k', 3, 1000, t0 + 1200), false); // janela passou
  assert.equal(rateLimitedLocal('outra', 3, 1000, t0), false);     // chaves independentes
});

test('sem Redis configurado usa o limite local', async () => {
  const env = {};
  assert.equal(await rateLimited('a', 2, 1000, { env, now: 1000 }), false);
  assert.equal(await rateLimited('a', 2, 1000, { env, now: 1001 }), false);
  assert.equal(await rateLimited('a', 2, 1000, { env, now: 1002 }), true);
});

test('com Redis: o limite vale entre instâncias (contador compartilhado) e envia o token', async () => {
  const r = fakeRedis();
  const t = 5_000_000;
  // "duas instâncias" = dois chamadores com memória local separada, mas o mesmo Redis
  const r1 = await rateLimited('user:1', 3, 60_000, { env: ENV, fetchImpl: r.fetchImpl, now: t });
  _resetLocal();
  const r2 = await rateLimited('user:1', 3, 60_000, { env: ENV, fetchImpl: r.fetchImpl, now: t + 1 });
  _resetLocal();
  const r3 = await rateLimited('user:1', 3, 60_000, { env: ENV, fetchImpl: r.fetchImpl, now: t + 2 });
  _resetLocal();
  const r4 = await rateLimited('user:1', 3, 60_000, { env: ENV, fetchImpl: r.fetchImpl, now: t + 3 });
  assert.deepEqual([r1, r2, r3, r4], [false, false, false, true]);
  assert.equal(r.calls[0].auth, 'Bearer tok');
  assert.equal(r.calls[0].url, 'https://redis.example.io/pipeline'); // sem barra dupla
  assert.equal(r.calls[0].cmds[0][0], 'INCR'); assert.equal(r.calls[0].cmds[1][0], 'PEXPIRE');
});

test('com Redis: janela nova começa do zero (chave por janela)', async () => {
  const r = fakeRedis();
  const w = 1000;
  for (let i = 0; i < 2; i++) await rateLimited('k', 2, w, { env: ENV, fetchImpl: r.fetchImpl, now: 10_000 + i });
  assert.equal(await rateLimited('k', 2, w, { env: ENV, fetchImpl: r.fetchImpl, now: 10_500 }), true);
  assert.equal(await rateLimited('k', 2, w, { env: ENV, fetchImpl: r.fetchImpl, now: 11_100 }), false); // próxima janela
  assert.equal(r.counters.size, 2);
});

test('Redis fora do ar, lento ou com resposta ruim: cai para o limite local (não derruba, não libera tudo)', async () => {
  const quebra = async () => { throw new Error('rede'); };
  assert.equal(await rateLimited('f', 1, 1000, { env: ENV, fetchImpl: quebra, now: 1 }), false);
  assert.equal(await rateLimited('f', 1, 1000, { env: ENV, fetchImpl: quebra, now: 2 }), true); // local ainda barra

  _resetLocal();
  const http500 = async () => ({ ok: false, json: async () => ({}) });
  assert.equal(await rateLimited('g', 1, 1000, { env: ENV, fetchImpl: http500, now: 1 }), false);
  assert.equal(await rateLimited('g', 1, 1000, { env: ENV, fetchImpl: http500, now: 2 }), true);

  _resetLocal();
  const lixo = async () => ({ ok: true, json: async () => [{ error: 'WRONGPASS' }] });
  assert.equal(await rateLimited('h', 1, 1000, { env: ENV, fetchImpl: lixo, now: 1 }), false);
  assert.equal(await rateLimited('h', 1, 1000, { env: ENV, fetchImpl: lixo, now: 2 }), true);
});
