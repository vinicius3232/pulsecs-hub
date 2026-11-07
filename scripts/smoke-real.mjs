#!/usr/bin/env node
/**
 * scripts/smoke-real.mjs
 * 
 * Script de Smoke Test para validar o provisionamento do Supabase real do PulseCS.
 * Executa verificações de integridade de tabelas, validação de Row-Level Security (RLS),
 * isolamento de papéis e sanitização de dados temporários.
 * 
 * Uso:
 *   SUPABASE_URL="https://xxx.supabase.co" \
 *   SUPABASE_ANON_KEY="eyJ..." \
 *   SUPABASE_SERVICE_ROLE_KEY="eyJ..." \
 *   node scripts/smoke-real.mjs
 * 
 * ATENÇÃO: NUNCA execute este script contra um banco de dados de produção ativo
 * sem expressa autorização do usuário gestor.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('\n❌ ERRO: Variáveis de ambiente obrigatórias ausentes.');
  console.error('Para executar o smoke test em seu Supabase de teste/staging, forneça:');
  console.error('  - SUPABASE_URL');
  console.error('  - SUPABASE_ANON_KEY');
  console.error('  - SUPABASE_SERVICE_ROLE_KEY\n');
  console.error('Exemplo no PowerShell:');
  console.error('  $env:SUPABASE_URL="https://seu-projeto.supabase.co"');
  console.error('  $env:SUPABASE_ANON_KEY="eyJ..."');
  console.error('  $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."');
  console.error('  node scripts/smoke-real.mjs\n');
  process.exit(1);
}

const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

let totalChecks = 0;
let passedChecks = 0;

function report(name, passed, details = '') {
  totalChecks++;
  if (passed) {
    passedChecks++;
    console.log(`  ✅ [APROVADO] ${name}`);
  } else {
    console.error(`  ❌ [REPROVADO] ${name}${details ? ` -> ${details}` : ''}`);
  }
}

async function runSmokeTest() {
  console.log('\n======================================================');
  console.log('🧪 PULSECS — SMOKE TEST DE VALIDAÇÃO DO SUPABASE REAL');
  console.log(`Alvo: ${SUPABASE_URL}`);
  console.log('======================================================\n');

  // 1. Verificação de Conexão com Service Role
  console.log('1. Conectividade & Schema Base (Service Role):');
  try {
    const { data, error } = await adminClient.from('csm_users').select('count', { count: 'exact', head: true });
    report('Conexão ao banco e tabela csm_users', !error, error?.message);
  } catch (err) {
    report('Conexão ao banco e tabela csm_users', false, err.message);
  }

  try {
    const { error } = await adminClient.from('companies').select('count', { count: 'exact', head: true });
    report('Tabela companies acessível via admin', !error, error?.message);
  } catch (err) {
    report('Tabela companies acessível via admin', false, err.message);
  }

  try {
    const { error } = await adminClient.from('event_log').select('count', { count: 'exact', head: true });
    report('Fila durável event_log acessível via admin', !error, error?.message);
  } catch (err) {
    report('Fila durável event_log acessível via admin', false, err.message);
  }

  // 2. Proteção RLS com Cliente Anônimo (Nenhum dado do app pode vazar)
  console.log('\n2. Auditoria RLS de Cliente Anônimo (Negação Total):');
  try {
    const { data } = await anonClient.from('companies').select('id, name');
    report('Anon: Bloqueio estrito de leitura em companies', !data || data.length === 0, `vazou ${data?.length} registros`);
  } catch {
    report('Anon: Bloqueio estrito de leitura em companies', true);
  }

  try {
    const { data } = await anonClient.from('csm_users').select('id, email');
    report('Anon: Bloqueio estrito de leitura em csm_users', !data || data.length === 0, `vazou ${data?.length} registros`);
  } catch {
    report('Anon: Bloqueio estrito de leitura em csm_users', true);
  }

  try {
    const { data } = await anonClient.from('event_log').select('id');
    report('Anon: Bloqueio estrito de leitura em event_log', !data || data.length === 0, `vazou ${data?.length} registros`);
  } catch {
    report('Anon: Bloqueio estrito de leitura em event_log', true);
  }

  try {
    const { error } = await anonClient.from('companies').insert({ name: 'Tentativa Invasão Anon' });
    report('Anon: Bloqueio estrito de escrita (insert) em companies', Boolean(error), 'escrita foi permitida sem autenticação');
  } catch {
    report('Anon: Bloqueio estrito de escrita (insert) em companies', true);
  }

  // 3. Validação de Idempotência e Webhook Deliveries
  console.log('\n3. Mecanismo de Idempotência & Webhooks:');
  const testExternalId = `smoke_test_${Date.now()}`;
  try {
    const { error: insertErr } = await adminClient.from('webhook_deliveries').insert({
      source: 'smoke_test',
      external_id: testExternalId,
      status: 'received',
      payload: { smoke: true }
    });
    report('Service Role: Registro de entrega em webhook_deliveries', !insertErr, insertErr?.message);

    // Tentativa de duplicar a mesma chave externa deve falhar por violação de UNIQUE
    const { error: dupeErr } = await adminClient.from('webhook_deliveries').insert({
      source: 'smoke_test',
      external_id: testExternalId,
      status: 'received',
      payload: { smoke: true }
    });
    report('Idempotência: Bloqueio de duplicata (UNIQUE constraint)', Boolean(dupeErr), 'permitiu duplicar external_id');

    // Limpeza do registro de teste
    await adminClient.from('webhook_deliveries').delete().eq('external_id', testExternalId);
  } catch (err) {
    report('Mecanismo de idempotência em webhook_deliveries', false, err.message);
  }

  // 4. Teste de Criação e Reconciliação do Health Score (Ciclo de Vida)
  console.log('\n4. Integridade do Motor de Health Score:');
  let createdCompanyId = null;
  try {
    const testCnpj = `99${Date.now().toString().slice(-12)}`;
    const { data: newCompany, error: createErr } = await adminClient.from('companies').insert({
      name: 'Smoke Test Empresa Temporária',
      cnpj: testCnpj,
      tier: 'Mid-Market',
      mrr: 1500.00,
      eligible_lives: 100,
      active_lives: 80,
      mau_lives: 60,
      phase: 'Kickoff'
    }).select('id, health_score, health_status').single();

    if (createErr) {
      report('Criação de empresa de teste com métricas', false, createErr.message);
    } else {
      createdCompanyId = newCompany.id;
      report('Criação de empresa de teste com métricas', true);
      report('Cálculo de Health Score automático gerado', typeof newCompany.health_score === 'number', `score: ${newCompany.health_score}`);
    }
  } catch (err) {
    report('Teste do motor de Health Score', false, err.message);
  } finally {
    if (createdCompanyId) {
      await adminClient.from('companies').delete().eq('id', createdCompanyId);
      console.log('  🧹 Limpeza: Registro temporário de teste removido com sucesso.');
    }
  }

  // Relatório Final
  console.log('\n======================================================');
  console.log(`📊 RESULTADO FINAL: ${passedChecks}/${totalChecks} verificações aprovadas.`);
  console.log('======================================================\n');

  if (passedChecks === totalChecks) {
    console.log('🎉 O banco Supabase está configurado corretamente e pronto para produção!');
    process.exit(0);
  } else {
    console.error('⚠️ Algumas verificações falharam. Verifique os logs e as permissões RLS no schema.');
    process.exit(1);
  }
}

runSmokeTest().catch((err) => {
  console.error('Falha fatal durante a execução do smoke test:', err);
  process.exit(1);
});
