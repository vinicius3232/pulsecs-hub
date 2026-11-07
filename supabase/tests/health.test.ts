// Health Score no servidor: paridade com o TypeScript, recálculo, snapshots e permissões.
// Rode com:  npm run test:health   (PGlite = Postgres embutido; não é o Supabase)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { calculateAdoptionHealthScore } from '../../src/lib/health-score.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = (f: string) => readFileSync(join(root, f), 'utf8');

let db: PGlite;
const U = { head: 'aaaaaaaa-0000-0000-0000-000000000001', csm: 'aaaaaaaa-0000-0000-0000-000000000002', is: 'aaaaaaaa-0000-0000-0000-000000000004' };
const CSM = { head: 'bbbbbbbb-0000-0000-0000-000000000001', csm: 'bbbbbbbb-0000-0000-0000-000000000002', is: 'bbbbbbbb-0000-0000-0000-000000000004' };

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  `);
  await db.exec(sql('schema.sql').replace(/^.*uuid-ossp.*$/m, ''));
  for (const f of ['0002_event_log_automation', '0003_workflow_steps_and_views']) await db.exec(sql(`migrations/${f}.sql`));
  await db.exec(`grant usage on schema public to anon, authenticated, service_role; grant all on all tables in schema public to anon, authenticated, service_role;`);
  for (const f of ['0004_rls_by_role', '0005_health_score_server', '0005_health_score_server', '0006_webhook_idempotency', '0007_external_mappings_and_health_config', '0008_health_config_wiring_and_unmatched_queue']) await db.exec(sql(`migrations/${f}.sql`)); // 0005 idempotente
  await db.exec(`grant all on all tables in schema public to authenticated, service_role;`);
  for (const id of Object.values(U)) await db.exec(`insert into auth.users(id) values ('${id}')`);
  await db.exec(`insert into csm_users(id,auth_id,name,email,role) values
    ('${CSM.head}','${U.head}','H','h@x.com','head'),('${CSM.csm}','${U.csm}','C','c@x.com','csm'),('${CSM.is}','${U.is}','I','i@x.com','is')`);
});

async function as(who: 'head' | 'csm' | 'is' | 'service', q: string) {
  await db.exec(`reset role; select set_config('app.uid', '${who === 'service' ? '' : U[who]}', false); set role ${who === 'service' ? 'service_role' : 'authenticated'};`);
  try { const r = await db.query<any>(q); return { rows: r.rows, count: r.affectedRows ?? r.rows.length, error: null as string | null }; }
  catch (e: any) { return { rows: [] as any[], count: 0, error: e.message as string }; }
  finally { await db.exec('reset role'); }
}
const scalar = async (q: string) => (await db.query<any>(q)).rows[0];

// PRNG determinístico
function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; }; }
const norm = (s: string) => s.replace(/\d+(\.\d+)?/g, '#');

test('paridade SQL x TypeScript: 600 combinações (score, status, taxas e fatores de risco)', async () => {
  const r = rng(42);
  const int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  let compared = 0;
  for (let i = 0; i < 600; i++) {
    const eligible = int(1, 2000);
    const active = int(0, eligible);
    const mau = int(0, active);
    const rh = r() < 0.12 ? null : int(0, 60);
    const renew = int(-15, 200);
    const nps = r() < 0.15 ? null : int(0, 20) / 2;
    const overdue = r() < 0.2;

    const ts = calculateAdoptionHealthScore({ eligible_lives: eligible, active_lives: active, mau_lives: mau, rh_last_login_days: rh, days_to_renewal: renew, nps_score: nps ?? undefined, has_overdue_invoice: overdue });
    const row = await scalar(`select public.fn_health_calc(${eligible},${active},${mau},${rh === null ? 'null' : rh},${renew},${nps === null ? 'null' : nps},${overdue}) as c`);
    const sq = row.c;
    const ctx = JSON.stringify({ eligible, active, mau, rh, renew, nps, overdue });
    assert.equal(sq.score, ts.score, 'score ' + ctx);
    assert.equal(sq.status, ts.status, 'status ' + ctx);
    assert.ok(Math.abs(sq.activation_rate - ts.activation_rate) < 0.006, 'ativação ' + ctx);
    assert.ok(Math.abs(sq.mau_rate - ts.mau_rate) < 0.006, 'mau ' + ctx);
    assert.deepEqual(sq.risk_factors.map(norm), ts.risk_factors.map(norm), 'fatores ' + ctx);
    compared++;
  }
  assert.equal(compared, 600);
});

test('casos de borda da fórmula (limites exatos)', async () => {
  const calc = async (...a: (number | null | boolean)[]) => (await scalar(`select public.fn_health_calc(${a.map(x => x === null ? 'null' : x).join(',')}) as c`)).c;
  // 80% de ativação exatos, 75% de MAU exatos, RH hoje, renova em 61 dias, NPS 9 => nota máxima
  assert.equal((await calc(100, 80, 60, 0, 61, 9, false)).score, 100);
  // 79,9% de ativação cai para 60 pontos; 599/799 = 74,97% de MAU também (< 75)
  assert.equal((await calc(1000, 799, 599, 0, 90, 9, false)).score, Math.round(0.35 * 60 + 0.25 * 60 + 0.15 * 100 + 0.15 * 100 + 0.10 * 100));
  // exatamente 80% e 75%: topo de cada faixa
  assert.equal((await calc(1000, 800, 600, 0, 90, 9, false)).score, 100);
  // inadimplência nunca deixa negativo
  assert.equal((await calc(100, 0, 0, 90, 10, 0, true)).score, 0);
  // eleg. 0 não explode (divisão por zero)
  assert.equal(typeof (await calc(0, 0, 0, 5, 100, 8, false)).score, 'number');
});

test('recálculo: grava score, status, fatores e UM snapshot por dia', async () => {
  await db.exec(`insert into companies(id,name,eligible_lives,active_lives,mau_lives,last_login_at,renewal_date,csm_id)
    values ('c0000000-0000-0000-0000-000000000001','Com métricas',1000,300,100, now() - interval '20 days', current_date + 30, '${CSM.csm}')`);
  await db.exec(`delete from event_log`);
  assert.equal((await scalar(`select public.fn_recompute_health('c0000000-0000-0000-0000-000000000001') as n`)).n, 1);
  const c = await scalar(`select health_score, health_status, risk_factors, health_computed_at from companies where name='Com métricas'`);
  assert.equal(c.health_status, 'red');
  assert.ok(c.health_score < 50);
  assert.ok(c.risk_factors.length >= 3);
  assert.ok(c.health_computed_at);
  await db.exec(`select public.fn_recompute_health('c0000000-0000-0000-0000-000000000001')`); // de novo, mesmo dia
  assert.equal((await scalar(`select count(*)::int as n from health_snapshots`)).n, 1);
  const snap = await scalar(`select activation_rate, mau_rate, health_score from health_snapshots`);
  assert.equal(Number(snap.activation_rate), 30); assert.equal(Number(snap.mau_rate), 33.33);
  assert.equal(snap.health_score, c.health_score);
});

test('empresa sem métricas NÃO é pontuada (sem falso alarme) e avisa o motivo', async () => {
  await db.exec(`insert into companies(id,name,health_score,health_status,csm_id) values ('c0000000-0000-0000-0000-000000000002','Sem métricas',85,'green','${CSM.csm}')`);
  await db.exec(`select public.fn_recompute_health()`);
  const c = await scalar(`select health_score, health_status, risk_factors, health_computed_at from companies where name='Sem métricas'`);
  assert.equal(c.health_score, 85); assert.equal(c.health_status, 'green'); assert.equal(c.health_computed_at, null);
  assert.match(c.risk_factors[0], /Sem métricas/);
  assert.equal((await scalar(`select count(*)::int as n from health_snapshots where company_id='c0000000-0000-0000-0000-000000000002'`)).n, 0);
});

test('gatilho: mudar uma entrada recalcula; mudar o nome não; mudança de status gera evento', async () => {
  const id = 'c0000000-0000-0000-0000-000000000001';
  const before = (await scalar(`select health_score s from companies where id='${id}'`)).s;
  await db.exec(`delete from event_log`);
  await as('service', `update companies set active_lives = 900, mau_lives = 800, last_login_at = now(), renewal_date = current_date + 300 where id='${id}'`);
  const after = await scalar(`select health_score s, health_status st from companies where id='${id}'`);
  assert.ok(after.s > before, `score deveria subir (${before} -> ${after.s})`);
  assert.equal(after.st, 'green');
  const ev = await db.query<any>(`select payload from event_log where event_type='company.health_changed'`);
  assert.equal(ev.rows.length, 1);
  assert.equal(ev.rows[0].payload.from, 'red'); assert.equal(ev.rows[0].payload.to, 'green');

  const t1 = (await scalar(`select health_computed_at t from companies where id='${id}'`)).t;
  await new Promise(r => setTimeout(r, 15));
  await as('service', `update companies set name = 'Com métricas 2' where id='${id}'`);
  const t2 = (await scalar(`select health_computed_at t from companies where id='${id}'`)).t;
  assert.equal(String(t1), String(t2), 'renomear não deve recalcular');
});

test('integridade: ativadas > elegíveis, MAU > ativadas e valores negativos são recusados', async () => {
  const id = 'c0000000-0000-0000-0000-000000000001';
  for (const set of ['active_lives = 99999', 'mau_lives = 99999', 'eligible_lives = -1', 'nps_score = 11']) {
    const r = await as('service', `update companies set ${set} where id='${id}'`);
    assert.ok(r.error, set);
  }
});

test('permissões: csm/is não mexem em métricas nem no score; head corrige; csm edita o resto', async () => {
  const id = 'c0000000-0000-0000-0000-000000000001';
  for (const who of ['csm', 'is'] as const) {
    for (const set of ['active_lives = 10', 'total_savings = 1', "health_score = 1", "health_status = 'red'", 'nps_score = 10', 'has_overdue_invoice = true', 'renewal_date = current_date + 1', "last_login_at = now()"]) {
      const r = await as(who, `update companies set ${set} where id='${id}'`);
      assert.ok(r.error && /servidor|perfil/.test(r.error), `${who}: ${set} -> ${r.error}`);
    }
  }
  assert.equal((await as('csm', `update companies set name='Renomeado pelo csm' where id='${id}'`)).error, null);
  const h = await as('head', `update companies set active_lives = 500, mau_lives = 100 where id='${id}'`);
  assert.equal(h.error, null);
  assert.ok((await scalar(`select health_score s from companies where id='${id}'`)).s < 90); // recalculado após a correção do head
});

test('csm cria empresa: funciona, e métricas/score nascem nos padrões (não dá para semear)', async () => {
  const r = await as('csm', `insert into companies(name, csm_id, eligible_lives, active_lives, mau_lives, health_score, health_status, nps_score)
    values ('Criada pelo csm','${CSM.csm}', 1000, 1000, 1000, 100, 'green', 10) returning id`);
  assert.equal(r.error, null, r.error ?? '');
  const c = await scalar(`select eligible_lives, active_lives, health_score, health_status, nps_score, health_computed_at from companies where name='Criada pelo csm'`);
  assert.equal(c.eligible_lives, 0); assert.equal(c.active_lives, 0); assert.equal(c.health_score, 85); assert.equal(c.nps_score, null); assert.equal(c.health_computed_at, null);
});

test('a marca interna não vaza: após um recálculo o guard volta a valer na mesma sessão', async () => {
  const id = 'c0000000-0000-0000-0000-000000000001';
  await as('head', `update companies set nps_score = 8 where id='${id}'`); // dispara recálculo (marca interna ligada e desligada)
  const r = await as('csm', `update companies set nps_score = 10 where id='${id}'`);
  assert.ok(r.error);
});

test('seed.sql continua válido com as novas regras e todas as empresas recebem score', async () => {
  await db.exec(`reset role; select set_config('app.uid', '', false); set role service_role`); // service role: sem usuário de sessão
  await db.exec(readFileSync(join(root, 'seed.sql'), 'utf8'));
  await db.exec('reset role');
  const n = await scalar(`select public.fn_recompute_health() as n`);
  const rows = (await db.query<any>(`select health_status, count(*)::int n from companies where name not in ('Com métricas 2','Renomeado pelo csm','Sem métricas','Criada pelo csm') group by 1`)).rows;
  assert.ok(n.n >= 11, 'recalculou ' + n.n);
  assert.ok(rows.every(r => ['green', 'yellow', 'red'].includes(r.health_status)));
  assert.equal((await scalar(`select count(*)::int n from companies where eligible_lives > 0 and health_computed_at is null`)).n, 0);
});

test('paridade SQL x TypeScript: calibração de pesos customizados e tabela health_config', async () => {
  // Teste de calibração alternativa: Ativação 40%, MAU 20%, RH 15%, Renovação 15%, NPS 10%, Penalidade 30, Limiares 80 e 60
  const customConfig = {
    weight_activation: 0.40,
    weight_mau: 0.20,
    weight_rh: 0.15,
    weight_renewal: 0.15,
    weight_nps: 0.10,
    penalty_overdue: 30,
    threshold_green: 80,
    threshold_yellow: 60
  };

  const cases = [
    { eligible: 1000, active: 850, mau: 700, rh: 3, renew: 90, nps: 9, overdue: false },
    { eligible: 500, active: 200, mau: 50, rh: 20, renew: 45, nps: 6, overdue: true },
    { eligible: 2000, active: 1800, mau: 1500, rh: null, renew: 15, nps: 10, overdue: false },
    { eligible: 100, active: 90, mau: 80, rh: 10, renew: 120, nps: 8, overdue: false }
  ];

  for (const c of cases) {
    const ts = calculateAdoptionHealthScore({
      eligible_lives: c.eligible,
      active_lives: c.active,
      mau_lives: c.mau,
      rh_last_login_days: c.rh,
      days_to_renewal: c.renew,
      nps_score: c.nps,
      has_overdue_invoice: c.overdue
    }, customConfig);

    const sqlRes = await scalar(`
      select public.fn_health_calc_configurable(
        ${c.eligible}, ${c.active}, ${c.mau}, ${c.rh === null ? 'null' : c.rh}, ${c.renew},
        ${c.nps}, ${c.overdue},
        ${customConfig.weight_activation}, ${customConfig.weight_mau},
        ${customConfig.weight_rh}, ${customConfig.weight_renewal},
        ${customConfig.weight_nps}, ${customConfig.penalty_overdue},
        ${customConfig.threshold_green}, ${customConfig.threshold_yellow}
      ) as res
    `);

    assert.equal(ts.score, sqlRes.res.score, `Divergência de score: TS=${ts.score} vs SQL=${sqlRes.res.score}`);
    assert.equal(ts.status, sqlRes.res.status, `Divergência de status: TS=${ts.status} vs SQL=${sqlRes.res.status}`);
  }
});
