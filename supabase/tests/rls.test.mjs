// Testes de RLS por perfil, em um Postgres de verdade (PGlite, embutido).
// Rode com:  npm run test:rls
//
// O PGlite não é o Supabase: aqui simulamos os papéis (anon/authenticated/service_role),
// o schema "auth" (auth.uid() lê a variável app.uid) e os GRANTs padrão do Supabase.
// A extensão uuid-ossp não existe no PGlite e o schema só usa gen_random_uuid(); por isso a linha é removida na cópia.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = f => readFileSync(join(root, f), 'utf8');

const U = {
  head:     'aaaaaaaa-0000-0000-0000-000000000001',
  csmA:     'aaaaaaaa-0000-0000-0000-000000000002',
  csmB:     'aaaaaaaa-0000-0000-0000-000000000003',
  is:       'aaaaaaaa-0000-0000-0000-000000000004',
  viewer:   'aaaaaaaa-0000-0000-0000-000000000005',
  inactive: 'aaaaaaaa-0000-0000-0000-000000000006',
  outsider: 'aaaaaaaa-0000-0000-0000-000000000007'
};
const CSM = { head: 'bbbbbbbb-0000-0000-0000-000000000001', csmA: 'bbbbbbbb-0000-0000-0000-000000000002', csmB: 'bbbbbbbb-0000-0000-0000-000000000003', is: 'bbbbbbbb-0000-0000-0000-000000000004', viewer: 'bbbbbbbb-0000-0000-0000-000000000005', inactive: 'bbbbbbbb-0000-0000-0000-000000000006' };
const C = { c1: 'cccccccc-0000-0000-0000-000000000001', c2: 'cccccccc-0000-0000-0000-000000000002', c3: 'cccccccc-0000-0000-0000-000000000003', c4: 'cccccccc-0000-0000-0000-000000000004' };

let db;

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  `);
  await db.exec(sql('schema.sql').replace(/^.*uuid-ossp.*$/m, ''));
  await db.exec(sql('migrations/0002_event_log_automation.sql'));
  await db.exec(sql('migrations/0003_workflow_steps_and_views.sql'));
  // GRANTs padrão do Supabase (tabelas novas já nascem acessíveis a anon/authenticated)
  await db.exec(`grant usage on schema public to anon, authenticated, service_role;
                 grant all on all tables in schema public to anon, authenticated, service_role;`);
  await db.exec(sql('migrations/0004_rls_by_role.sql'));
  await db.exec(sql('migrations/0004_rls_by_role.sql')); // idempotente
  await db.exec(sql('migrations/0005_health_score_server.sql')); // guard de colunas e recálculo convivem com a RLS
  await db.exec(sql('migrations/0006_webhook_idempotency.sql'));
  await db.exec(sql('migrations/0007_external_mappings_and_health_config.sql'));

  for (const id of Object.values(U)) await db.exec(`insert into auth.users(id) values ('${id}')`);
  await db.exec(`
    insert into csm_users(id, auth_id, name, email, role, is_active) values
      ('${CSM.head}','${U.head}','Head','head@x.com','head',true),
      ('${CSM.csmA}','${U.csmA}','A','a@x.com','csm',true),
      ('${CSM.csmB}','${U.csmB}','B','b@x.com','csm',true),
      ('${CSM.is}','${U.is}','IS','is@x.com','is',true),
      ('${CSM.viewer}','${U.viewer}','V','v@x.com','viewer',true),
      ('${CSM.inactive}','${U.inactive}','X','x@x.com','csm',false);
    insert into companies(id,name,csm_id,phase,mrr) values
      ('${C.c1}','C1 (A, Go-Live)','${CSM.csmA}','Go-Live',1000),
      ('${C.c2}','C2 (B, Config)','${CSM.csmB}','Config & Carga',2000),
      ('${C.c3}','C3 (sem gestor, Kickoff)',null,'Kickoff',3000),
      ('${C.c4}','C4 (A, Config)','${CSM.csmA}','Config & Carga',4000);
    insert into contacts(company_id,name,email) values ('${C.c1}','Ct1','c1@x.com'),('${C.c2}','Ct2','c2@x.com');
    insert into meetings(company_id,scheduled_at,subject) values ('${C.c1}',now(),'m1');
    insert into interactions(company_id,csm_id,channel,trigger_type,content) values ('${C.c1}','${CSM.csmA}','note','t','i1');
    insert into health_snapshots(company_id,health_score) values ('${C.c1}',80);
    insert into csm_tasks(company_id,csm_id,title) values ('${C.c1}','${CSM.csmA}','tarefa de A'),('${C.c2}','${CSM.csmB}','tarefa de B');
  `);
  // limpa os eventos que os triggers geraram na carga inicial
  await db.exec(`delete from event_log`);
});

/** Executa como um usuário autenticado (ou anon). Devolve { rows, count, error }. */
async function as(who, query) {
  const claims = who === 'anon' ? null : U[who];
  await db.exec(`reset role; select set_config('app.uid', '${claims ?? ''}', false); set role ${who === 'anon' ? 'anon' : 'authenticated'};`);
  try {
    const r = await db.query(query);
    return { rows: r.rows, count: r.affectedRows ?? r.rows.length, error: null };
  } catch (e) {
    return { rows: [], count: 0, error: e.message };
  } finally {
    await db.exec('reset role');
  }
}
const ok = r => assert.equal(r.error, null, r.error);
const denied = r => assert.ok(r.error, 'era esperado erro de permissão/RLS');
const blocked = r => { assert.equal(r.error, null, r.error); assert.equal(r.count, 0, 'era esperado 0 linhas afetadas'); };

// ---------------------------------------------------------------------------
test('anon: nenhuma tabela do app é acessível', async () => {
  for (const t of ['companies', 'contacts', 'meetings', 'interactions', 'csm_users', 'csm_tasks', 'event_log', 'automation_rules', 'saved_views', 'health_snapshots']) {
    denied(await as('anon', `select * from ${t}`));
  }
});

test('autenticado fora da equipe (sign-up público) e usuário inativo: nada, em nenhuma tabela', async () => {
  for (const who of ['outsider', 'inactive']) {
    for (const t of ['companies', 'contacts', 'meetings', 'interactions', 'csm_users', 'csm_tasks', 'automation_rules', 'health_snapshots']) {
      const r = await as(who, `select * from ${t}`);
      ok(r); assert.equal(r.rows.length, 0, `${who} leu ${t}`);
    }
    denied(await as(who, `insert into contacts(company_id,name,email) values ('${C.c3}','x','x@x.com')`));
    blocked(await as(who, `update companies set name='hack'`));
    denied(await as(who, `insert into companies(name) values ('x')`));
  }
});

test('viewer: lê tudo da equipe, não escreve em nada de negócio', async () => {
  assert.equal((await as('viewer', 'select * from companies')).rows.length, 4);
  assert.equal((await as('viewer', 'select * from contacts')).rows.length, 2);
  assert.equal((await as('viewer', 'select * from csm_users')).rows.length, 6);
  blocked(await as('viewer', `update companies set name='x'`));
  blocked(await as('viewer', `delete from companies`));
  denied(await as('viewer', `insert into companies(name,csm_id) values ('x','${CSM.viewer}')`));
  denied(await as('viewer', `insert into contacts(company_id,name,email) values ('${C.c3}','x','x@x.com')`));
  denied(await as('viewer', `insert into meetings(company_id,scheduled_at,subject) values ('${C.c3}',now(),'x')`));
  denied(await as('viewer', `insert into interactions(company_id,channel,trigger_type,content) values ('${C.c3}','note','t','x')`));
  blocked(await as('viewer', `update csm_tasks set status='done'`));
  assert.equal((await as('viewer', 'select * from event_log')).rows.length, 0);
});

test('csm A: edita só as suas e assume as sem gestor; não reatribui nem apaga', async () => {
  assert.equal((await as('csmA', 'select * from companies')).rows.length, 4);
  assert.equal((await as('csmA', `update companies set name='C1 ok' where id='${C.c1}'`)).count, 1);
  blocked(await as('csmA', `update companies set name='hack' where id='${C.c2}'`));            // de B
  denied(await as('csmA', `update companies set csm_id='${CSM.csmB}' where id='${C.c4}'`));     // doar a carteira
  denied(await as('csmA', `update companies set csm_id='${CSM.csmB}' where id='${C.c3}'`));     // atribuir sem gestor a outro
  assert.equal((await as('csmA', `update companies set csm_id='${CSM.csmA}' where id='${C.c3}'`)).count, 1); // assumir
  blocked(await as('csmA', `delete from companies where id='${C.c1}'`));
  denied(await as('csmA', `insert into companies(name,csm_id) values ('x','${CSM.csmB}')`));
  ok(await as('csmA', `insert into companies(name,csm_id) values ('nova','${CSM.csmA}')`));
});

test('csm A: contatos, reuniões e interações só nas empresas que pode escrever', async () => {
  ok(await as('csmA', `insert into contacts(company_id,name,email) values ('${C.c1}','n','n@x.com')`));
  denied(await as('csmA', `insert into contacts(company_id,name,email) values ('${C.c2}','n','n2@x.com')`));
  blocked(await as('csmA', `update contacts set name='hack' where company_id='${C.c2}'`));
  ok(await as('csmA', `insert into meetings(company_id,scheduled_at,subject) values ('${C.c4}',now(),'ok')`));
  denied(await as('csmA', `insert into meetings(company_id,scheduled_at,subject) values ('${C.c2}',now(),'no')`));
  ok(await as('csmA', `insert into interactions(company_id,csm_id,channel,trigger_type,content) values ('${C.c1}','${CSM.csmA}','note','t','meu')`));
  denied(await as('csmA', `insert into interactions(company_id,csm_id,channel,trigger_type,content) values ('${C.c1}','${CSM.csmB}','note','t','em nome de B')`));
});

test('csm A: não vira head nem mexe na equipe; snapshots só leitura', async () => {
  blocked(await as('csmA', `update csm_users set role='head' where id='${CSM.csmA}'`));
  denied(await as('csmA', `insert into csm_users(name,email,role) values ('x','x1@x.com','head')`));
  blocked(await as('csmA', `delete from csm_users where id='${CSM.csmB}'`));
  denied(await as('csmA', `insert into health_snapshots(company_id,health_score) values ('${C.c1}',99)`));
  blocked(await as('csmA', `update health_snapshots set health_score=1`));
  assert.equal((await as('csmA', 'select * from health_snapshots')).rows.length, 1);
});

test('is: avança onboarding, mas não Go-Live, nem reatribui/mexe em valores', async () => {
  assert.equal((await as('is', `update companies set phase='Treinamento' where id='${C.c2}'`)).count, 1);
  blocked(await as('is', `update companies set name='hack' where id='${C.c1}'`));              // Go-Live
  denied(await as('is', `update companies set csm_id='${CSM.is}' where id='${C.c2}'`));         // trigger de colunas
  denied(await as('is', `update companies set mrr=1 where id='${C.c2}'`));
  denied(await as('is', `update companies set tier='SMB' where id='${C.c2}'`));
  denied(await as('is', `insert into companies(name) values ('x')`));
  blocked(await as('is', `delete from companies where id='${C.c2}'`));
  ok(await as('is', `insert into contacts(company_id,name,email) values ('${C.c2}','n','is@x.com')`));
  denied(await as('is', `insert into contacts(company_id,name,email) values ('${C.c1}','n','is2@x.com')`));
});

test('head: acesso total à operação e à equipe', async () => {
  const total = (await as('head', 'select * from companies')).rows.length; // inclui empresas criadas em testes anteriores
  assert.ok(total >= 4);
  assert.equal((await as('head', `update companies set name='h'`)).count, total);
  ok(await as('head', `insert into companies(name) values ('h-nova')`));
  ok(await as('head', `insert into csm_users(name,email,role) values ('Novo','novo@x.com','csm')`));
  assert.equal((await as('head', `update csm_users set role='viewer' where email='novo@x.com'`)).count, 1);
  assert.equal((await as('head', `delete from companies where name='h-nova'`)).count, 1);
  assert.ok((await as('head', 'select * from interactions')).rows.length >= 1);
});

test('automação: equipe lê regras e tarefas; só o Head altera regras; event_log só o Head lê', async () => {
  assert.ok((await as('csmA', 'select * from automation_rules')).rows.length >= 4);
  denied(await as('csmA', `insert into automation_rules(name,trigger_event) values ('r','company.created')`));
  blocked(await as('csmA', `update automation_rules set is_active=false`));
  ok(await as('head', `insert into automation_rules(name,trigger_event) values ('r-head','company.created')`));
  ok(await as('head', `update companies set health_status='red' where id='${C.c1}'`));      // gera evento por trigger
  assert.ok((await as('head', 'select * from event_log')).rows.length >= 1);
  assert.equal((await as('csmA', 'select * from event_log')).rows.length, 0);
  assert.equal((await as('csmA', 'select * from automation_scheduled_steps')).rows.length, 0);
  assert.equal((await as('csmA', 'select * from automation_rule_runs')).rows.length, 0);
});

test('tarefas: csm conclui as suas; não as de outro; viewer não altera', async () => {
  assert.equal((await as('csmA', `update csm_tasks set status='done' where title='tarefa de A'`)).count, 1);
  blocked(await as('csmA', `update csm_tasks set status='done' where title='tarefa de B'`));
  assert.equal((await as('head', `update csm_tasks set status='done' where title='tarefa de B'`)).count, 1);
});

test('views salvas: dono edita; outro csm só vê as compartilhadas; fora da equipe nada', async () => {
  ok(await as('csmA', `insert into saved_views(owner_id,name,filters) values ('${CSM.csmA}','Minha','{"status":"red"}')`));
  ok(await as('csmA', `insert into saved_views(owner_id,name,is_shared) values ('${CSM.csmA}','Time',true)`));
  denied(await as('csmA', `insert into saved_views(owner_id,name) values ('${CSM.csmB}','Em nome de B')`));
  const b = await as('csmB', 'select name from saved_views order by name');
  assert.deepEqual(b.rows.map(r => r.name), ['Time']);
  blocked(await as('csmB', `update saved_views set name='hack' where name='Time'`));
  assert.equal((await as('outsider', 'select * from saved_views')).rows.length, 0);
  assert.equal((await as('head', 'select * from saved_views')).rows.length, 2);
});

test('funções de worker não são chamáveis pelo navegador', async () => {
  denied(await as('head', 'select public.fn_emit_time_events()'));
  denied(await as('head', 'select * from public.fn_claim_events(1,1)'));
  denied(await as('head', 'select * from public.fn_claim_scheduled_steps(1,1)'));
});

test('service role continua operando (cron e webhook)', async () => {
  await db.exec(`reset role; select set_config('app.uid','',false); set role service_role`);
  const r = await db.query(`update companies set name = name where id='${C.c1}'`);
  assert.equal(r.affectedRows, 1);
  await db.query(`select public.fn_emit_time_events()`);
  await db.exec('reset role');
});

test('fase b: rls em health_config, company_external_mappings e unmatched_metrics', async () => {
  // health_config: CSM lê; só Head escreve/altera; anon/outsider nada
  const cfgHead = await as('head', 'select * from health_config where is_active = true');
  assert.equal(cfgHead.rows.length, 1);
  const cfgCsm = await as('csmA', 'select * from health_config where is_active = true');
  assert.equal(cfgCsm.rows.length, 1);
  assert.equal((await as('outsider', 'select * from health_config')).rows.length, 0);

  // Tentativa de CSM alterar pesos é bloqueada (0 linhas afetadas no update, erro no insert)
  blocked(await as('csmA', `update health_config set weight_activation = 0.50`));
  denied(await as('csmA', `insert into health_config(weight_activation, weight_mau, weight_rh, weight_renewal, weight_nps) values (0.4, 0.2, 0.2, 0.1, 0.1)`));

  // Head pode cadastrar nova calibração
  ok(await as('head', `insert into health_config(weight_activation, weight_mau, weight_rh, weight_renewal, weight_nps, notes) values (0.40, 0.20, 0.15, 0.15, 0.10, 'Calibracao Head')`));

  // company_external_mappings: CSM lê, só Head insere
  denied(await as('csmA', `insert into company_external_mappings(company_id, external_platform_id) values ('${C.c1}', 'ext_1')`));
  ok(await as('head', `insert into company_external_mappings(company_id, external_platform_id) values ('${C.c1}', 'ext_1')`));
  const maps = await as('csmA', 'select * from company_external_mappings');
  assert.equal(maps.rows.length, 1);

  // unmatched_metrics: equipe autenticada lê e atualiza
  await db.exec(`reset role; set role service_role; insert into unmatched_metrics(platform_id, reason) values ('p_1', 'pendente'); reset role;`);
  const un = await as('csmA', 'select * from unmatched_metrics');
  assert.equal(un.rows.length, 1);
  ok(await as('csmA', `update unmatched_metrics set resolved = true where platform_id = 'p_1'`));
  assert.equal((await as('outsider', 'select * from unmatched_metrics')).rows.length, 0);
});
