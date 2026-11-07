// Idempotência no banco: a UNIQUE é a trava (webhooks, tarefas abertas, esperas agendadas).
// Rode com:  npm run test:idempotency   (PGlite = Postgres embutido; não é o Supabase)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = (f: string) => readFileSync(join(root, f), 'utf8');
let db: PGlite;
const U = 'aaaaaaaa-0000-0000-0000-000000000001';

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  `);
  // Como no Supabase: tabelas NOVAS já nascem com permissão para anon/authenticated/service_role,
  // e é a migration que revoga o que não deve existir (por isso o teste de acesso é significativo).
  await db.exec(`grant usage on schema public to anon, authenticated, service_role;
                 alter default privileges in schema public grant all on tables to anon, authenticated, service_role;`);
  await db.exec(sql('schema.sql').replace(/^.*uuid-ossp.*$/m, ''));
  for (const f of ['0002_event_log_automation', '0003_workflow_steps_and_views']) await db.exec(sql(`migrations/${f}.sql`));
  for (const f of ['0004_rls_by_role', '0005_health_score_server', '0006_webhook_idempotency', '0006_webhook_idempotency', '0007_external_mappings_and_health_config', '0008_health_config_wiring_and_unmatched_queue', '0009_step_idempotency', '0009_step_idempotency']) await db.exec(sql(`migrations/${f}.sql`)); // migrations idempotentes
  await db.exec(`insert into auth.users(id) values ('${U}'); insert into csm_users(auth_id,name,email,role) values ('${U}','H','h@x.com','head')`);
});

async function as(who: 'head' | 'anon' | 'service', q: string) {
  await db.exec(`reset role; select set_config('app.uid', '${who === 'head' ? U : ''}', false); set role ${who === 'service' ? 'service_role' : who === 'anon' ? 'anon' : 'authenticated'};`);
  try { const r = await db.query<any>(q); return { rows: r.rows, error: null as string | null }; }
  catch (e: any) { return { rows: [] as any[], error: e.message as string }; }
  finally { await db.exec('reset role'); }
}

test('webhook_deliveries: a mesma chave não entra duas vezes (UNIQUE source+external_id)', async () => {
  assert.equal((await as('service', `insert into webhook_deliveries(source, external_id) values ('salez','deal:1')`)).error, null);
  const dup = await as('service', `insert into webhook_deliveries(source, external_id) values ('salez','deal:1')`);
  assert.match(dup.error ?? '', /unique|duplicate/i);
  assert.equal((await as('service', `insert into webhook_deliveries(source, external_id) values ('outra','deal:1')`)).error, null); // fontes independentes
});

test('webhook_deliveries: só o service role acessa (anon e autenticado, nem o head)', async () => {
  for (const who of ['anon', 'head'] as const) {
    assert.ok((await as(who, `select * from webhook_deliveries`)).error, who + ' leu');
    assert.ok((await as(who, `insert into webhook_deliveries(source, external_id) values ('x','y')`)).error, who + ' escreveu');
    assert.ok((await as(who, `delete from webhook_deliveries`)).error, who + ' apagou');
  }
});

test('webhook_deliveries: liberar (release) permite o reenvio; completar vincula a empresa', async () => {
  await as('service', `insert into webhook_deliveries(source, external_id) values ('salez','deal:2')`);
  await as('service', `delete from webhook_deliveries where source='salez' and external_id='deal:2'`);
  assert.equal((await as('service', `insert into webhook_deliveries(source, external_id) values ('salez','deal:2')`)).error, null);
  const c = (await as('service', `insert into companies(name) values ('Via webhook') returning id`)).rows[0];
  assert.equal((await as('service', `update webhook_deliveries set company_id='${c.id}' where external_id='deal:2'`)).error, null);
  // apagar a empresa não apaga o rastro da entrega (SET NULL): reenvio continua sendo duplicado
  await as('service', `delete from companies where id='${c.id}'`);
  const d = (await as('service', `select company_id from webhook_deliveries where external_id='deal:2'`)).rows[0];
  assert.equal(d.company_id, null);
  assert.ok((await as('service', `insert into webhook_deliveries(source, external_id) values ('salez','deal:2')`)).error);
});

test('retenção: fn_purge_webhook_deliveries apaga só as antigas e é restrita ao service role', async () => {
  await db.exec(`insert into webhook_deliveries(source, external_id, created_at) values ('salez','velha', now() - interval '120 days'), ('salez','recente', now() - interval '5 days')`);
  assert.ok((await as('head', `select public.fn_purge_webhook_deliveries(90)`)).error);
  const r = await as('service', `select public.fn_purge_webhook_deliveries(90) as n`);
  assert.equal(r.error, null);
  assert.equal(r.rows[0].n, 1);
  const left = (await as('service', `select external_id from webhook_deliveries where external_id in ('velha','recente')`)).rows.map(x => x.external_id);
  assert.deepEqual(left, ['recente']);
});

test('tarefa aberta: no máximo uma por (regra, empresa); depois de concluída, abre outra', async () => {
  const co = (await as('service', `insert into companies(name) values ('Dedupe') returning id`)).rows[0].id;
  const q = (k: string) => `insert into csm_tasks(company_id, title, dedupe_key) values ('${co}', 'x', '${k}')`;
  assert.equal((await as('service', q('r:1'))).error, null);
  assert.match((await as('service', q('r:1'))).error ?? '', /unique|duplicate/i);
  await as('service', `update csm_tasks set status='done' where dedupe_key='r:1'`);
  assert.equal((await as('service', q('r:1'))).error, null);
});

test('espera agendada: o mesmo passo da mesma execução não duplica; execução reprocessada faz upsert', async () => {
  const co = (await as('service', `insert into companies(name) values ('Espera') returning id`)).rows[0].id;
  const rule = (await as('service', `insert into automation_rules(name, trigger_event) values ('r-espera','company.created') returning id`)).rows[0].id;
  const ev = (await as('service', `insert into event_log(event_type, entity_kind, company_id) values ('company.created','company','${co}') returning id`)).rows[0].id;
  const step = `insert into automation_scheduled_steps(rule_id,event_id,company_id,event_type,next_index,resume_at) values ('${rule}','${ev}','${co}','company.created',1, now())`;
  assert.equal((await as('service', step)).error, null);
  assert.match((await as('service', step)).error ?? '', /unique|duplicate/i);
  const run = (status: string) => `insert into automation_rule_runs(rule_id,event_id,status) values ('${rule}','${ev}','${status}') on conflict (rule_id,event_id) do update set status = excluded.status`;
  await as('service', run('waiting')); await as('service', run('success'));
  assert.equal((await as('service', `select count(*)::int n from automation_rule_runs where rule_id='${rule}'`)).rows[0].n, 1);
});

test('evento de tempo: o mesmo fato (renovação/bucket) não entra duas vezes mesmo chamando duas vezes', async () => {
  await as('service', `insert into companies(name, renewal_date) values ('Renova', current_date + 20)`);
  const n1 = (await as('service', `select public.fn_emit_time_events() as n`)).rows[0].n;
  const n2 = (await as('service', `select public.fn_emit_time_events() as n`)).rows[0].n;
  assert.ok(n1 >= 1);
  assert.equal(n2, 0);
});

test('automation_step_idempotency: mesma chave por (execução, passo) não duplica (UNIQUE)', async () => {
  const co = (await as('service', `insert into companies(name) values ('StepIdem') returning id`)).rows[0].id;
  const rule = (await as('service', `insert into automation_rules(name, trigger_event) values ('r-step','company.created') returning id`)).rows[0].id;
  const ev = (await as('service', `insert into event_log(event_type, entity_kind, company_id) values ('company.created','company','${co}') returning id`)).rows[0].id;

  const ins = (stepKey: string, key: string) =>
    `insert into automation_step_idempotency(rule_id, event_id, step_key, idempotency_key, action_type) values ('${rule}','${ev}','${stepKey}','${key}','add_note')`;

  assert.equal((await as('service', ins('0', 'k1'))).error, null);
  // Segunda tentativa com a mesma chave ou mesmo passo leva erro de UNIQUE
  const dupKey = await as('service', ins('1', 'k1'));
  assert.match(dupKey.error ?? '', /unique|duplicate/i);
  const dupStep = await as('service', ins('0', 'k2'));
  assert.match(dupStep.error ?? '', /unique|duplicate/i);

  // Apenas service role acessa; anon e head são negados
  for (const who of ['anon', 'head'] as const) {
    assert.ok((await as(who, `select * from automation_step_idempotency`)).error, who + ' leu');
    assert.ok((await as(who, ins('2', 'k3'))).error, who + ' inseriu');
  }

  // Retenção: purge apaga registros antigos
  await db.exec(`insert into automation_step_idempotency(rule_id, event_id, step_key, idempotency_key, action_type, created_at)
    values ('${rule}','${ev}','old','k-old','add_note', now() - interval '120 days')`);
  assert.ok((await as('head', `select public.fn_purge_step_idempotency(90)`)).error);
  const purged = await as('service', `select public.fn_purge_step_idempotency(90) as n`);
  assert.equal(purged.rows[0].n, 1);
});
