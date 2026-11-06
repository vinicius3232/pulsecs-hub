// Testes das funções puras da camada de dados (sem navegador, sem Supabase).
// Rode com:  npm test
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { deepEqual as sameValue } from 'node:assert'; // por valor: objetos do vm têm outro Object.prototype
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// data-layer.js é um script de navegador: carregamos num contexto isolado (sem window/document)
const sandbox = {};
sandbox.globalThis = sandbox;
vm.runInNewContext(readFileSync(fileURLToPath(new URL('./data-layer.js', import.meta.url)), 'utf8'), sandbox);
const P = sandbox.PulseDataPure;

beforeEach(() => P._reset());

const U1 = 'c0000000-0000-4000-8000-000000000001';
const U2 = 'c1000000-0000-4000-8000-000000000002';

test('numId: estável, único e inverso de uuidFor', () => {
  const a = P.numId(U1);
  assert.equal(P.numId(U1), a);
  assert.equal(P.uuidFor(a), U1);
  assert.notEqual(P.numId(U2), a);
  assert.equal(P.numId(null), null);
  assert.equal(P.uuidFor(999999), null);
});

test('numId: colisão dos 8 primeiros hex não mistura empresas', () => {
  const x = 'abcdef12-0000-4000-8000-000000000001';
  const y = 'abcdef12-0000-4000-8000-000000000002'; // mesmo prefixo
  const a = P.numId(x), b = P.numId(y);
  assert.notEqual(a, b);
  assert.equal(P.uuidFor(a), x);
  assert.equal(P.uuidFor(b), y);
});

test('fmtLogin: hoje, ontem, N dias, sem registro', () => {
  const now = new Date(2026, 10, 6, 15, 0);
  assert.equal(P.fmtLogin(new Date(2026, 10, 6, 9, 5).toISOString(), now), 'Hoje, 09:05');
  assert.equal(P.fmtLogin(new Date(2026, 10, 5, 23, 59).toISOString(), now), 'Ontem, 23:59');
  assert.equal(P.fmtLogin(new Date(2026, 9, 25, 10, 0).toISOString(), now), 'Há 12 dias');
  assert.equal(P.fmtLogin(null, now), 'Sem registro');
  assert.equal(P.fmtLogin('lixo', now), 'Sem registro');
});

test('contato: "Nome (Papel)" ida e volta, sem parênteses e vazio', () => {
  sameValue(P.parseContact('Roberto Silva (Diretor)'), { name: 'Roberto Silva', role: 'Diretor' });
  sameValue(P.parseContact('Dra. Beatriz Santos'), { name: 'Dra. Beatriz Santos', role: 'Gestor de RH' });
  sameValue(P.parseContact('Ana (RH) '), { name: 'Ana', role: 'RH' });
  assert.equal(P.parseContact('').name, '');
  assert.equal(P.contactString({ name: 'Ana', role: 'RH' }), 'Ana (RH)');
  assert.equal(P.contactString(null), 'Sem contato');
  assert.equal(P.parseContact('x'.repeat(500)).name.length, 120);
});

test('renovação: faixas 30/60/90 e datas ausentes', () => {
  const now = new Date(2026, 10, 6);
  const d = n => new Date(2026, 10, 6 + n).toISOString().slice(0, 10);
  assert.equal(P.daysUntil(d(30), now), 30);
  assert.equal(P.renewalStage(P.daysUntil(d(30), now)), '30d');
  assert.equal(P.renewalStage(P.daysUntil(d(31), now)), '60d');
  assert.equal(P.renewalStage(P.daysUntil(d(60), now)), '60d');
  assert.equal(P.renewalStage(P.daysUntil(d(61), now)), '90d');
  assert.equal(P.renewalStage(P.daysUntil(d(-5), now)), '30d'); // vencida = mais urgente
  assert.equal(P.renewalStage(null), '90d');
  assert.equal(P.daysUntil(null, now), null);
});

test('mapCompany: converte tipos, higieniza enums e usa contato principal', () => {
  const now = new Date(2026, 10, 6, 12, 0);
  const row = { id: U1, name: 'Alpha', tier: 'Enterprise', mrr: '14500.50', health_score: 82, health_status: 'green', phase: 'Go-Live',
    risk_reason: null, last_login_at: new Date(2026, 10, 6, 9, 5).toISOString(), csm_id: U2, eligible_lives: 1000, active_lives: 800,
    mau_lives: 600, total_savings: '48200.00', pepm: '18.5', renewal_date: '2026-11-20' };
  const c = P.mapCompany(row, { id: 'k1', name: 'Roberto', role: 'Diretor', email: 'r@a.com', phone: '5511' }, now);
  assert.equal(c.mrr, 14500.5);
  assert.equal(c.riskReason, 'Nenhum');
  assert.equal(c.contact, 'Roberto (Diretor)');
  assert.equal(c.phone, '5511');
  assert.equal(c.email, 'r@a.com');
  assert.equal(c.csmId, P.numId(U2));
  assert.equal(c.uuid, U1);
  assert.equal(c.renewalStage, '30d');
  assert.equal(c.eligibleLives, 1000);
  assert.equal(c._contactId, 'k1');

  const bad = P.mapCompany({ ...row, tier: 'Hacker', phase: 'X', health_status: '<img>' }, null, now);
  assert.equal(bad.tier, 'Mid-Market'); assert.equal(bad.phase, 'Kickoff'); assert.equal(bad.status, 'yellow');
  assert.equal(bad.contact, 'Sem contato');
  const placeholder = P.mapCompany(row, { id: 'k', name: 'X', role: 'RH', email: P.NO_EMAIL, phone: null }, now);
  assert.equal(placeholder.email, ''); // placeholder .invalid não aparece como e-mail real
});

test('mapCsm: rótulo do papel, cor e iniciais seguras', () => {
  const t = P.mapCsm({ id: U1, name: 'Camila Prado', role: 'csm', color: '<x>', max_accounts: 5, status: 'Disponível' });
  assert.equal(t.role, 'CSM'); assert.equal(t.color, 'indigo'); assert.equal(t.avatar, 'CP'); assert.equal(t.maxAccounts, 5); assert.equal(t.dbRole, 'csm');
});

test('mapMeeting: hora local, tipo válido e briefing de reserva', () => {
  const at = new Date(2026, 10, 6, 14, 30).toISOString();
  const co = { name: 'Alpha', status: 'green', hs: 82 };
  const e = P.mapMeeting({ id: U1, company_id: U2, scheduled_at: at, meeting_type: 'Expansão', subject: 'S', ai_briefing: null, notes: 'nota', meet_url: null, completed: false }, co, null);
  assert.equal(e.time, '14:30'); assert.equal(e.day, 6); assert.equal(e.type, 'Alinhamento');
  assert.equal(e.briefing, 'nota'); assert.equal(e.company, 'Alpha'); assert.equal(e.contact, 'Sem contato');
  assert.equal(e.meetUrl, 'https://meet.google.com/new');
  assert.equal(P.mapMeeting({ id: U2, company_id: U1, scheduled_at: at, meeting_type: 'QBR', subject: 'x' }, undefined, null).company, 'Empresa removida');
});

test('companyPayload: valida enums, mrr, e mapeia o gestor para uuid', () => {
  const owner = P.numId(U2);
  const p = P.companyPayload({ name: '  Nova  ', tier: 'Hacker', mrr: -5, phase: 'X', riskReason: 'Nenhum', csmId: owner }, 'default-uuid');
  sameValue(p, { name: 'Nova', tier: 'Mid-Market', mrr: 0, phase: 'Kickoff', risk_reason: 'Nenhum', csm_id: U2 });
  assert.equal(P.companyPayload({ name: 'a', csmId: 123456 }, 'default-uuid').csm_id, 'default-uuid');
  assert.equal(P.companyPayload({ name: 'a' }, null).csm_id, null);
  assert.equal(P.companyPayload({ name: 'x'.repeat(500) }, null).name.length, 160);
});

test('payloads não carregam saúde (é do servidor) nem campos extras', () => {
  const p = P.companyPayload({ name: 'a', hs: 99, status: 'green', lastLogin: 'x', eligibleLives: 5, uuid: U1 }, null);
  for (const k of ['hs', 'status', 'health_score', 'health_status', 'lastLogin', 'uuid', 'id']) assert.ok(!(k in p), k);
});

test('contactPayload: e-mail válido ou placeholder .invalid; telefone só dígitos', () => {
  sameValue(P.contactPayload({ contact: 'Ana (RH)', email: 'ana@x.com', phone: '+55 (11) 98765-4321' }), { name: 'Ana', role: 'RH', email: 'ana@x.com', phone: '5511987654321' });
  const sem = P.contactPayload({ contact: 'Ana', email: 'nao-e-email', phone: '' });
  assert.equal(sem.email, P.NO_EMAIL); assert.equal(sem.phone, null); assert.equal(sem.role, 'Gestor de RH');
});

test('clientKey: muda com campos editáveis, ignora saúde e último login', () => {
  const base = { name: 'A', tier: 'SMB', mrr: 1, phase: 'Kickoff', riskReason: 'Nenhum', csmId: 1, contact: 'X (Y)' };
  const k = P.clientKey(base);
  assert.equal(P.clientKey({ ...base, hs: 10, status: 'red', lastLogin: 'agora' }), k);
  for (const patch of [{ name: 'B' }, { tier: 'Enterprise' }, { mrr: 2 }, { phase: 'Go-Live' }, { riskReason: 'r' }, { csmId: 2 }, { contact: 'Z (W)' }]) {
    assert.notEqual(P.clientKey({ ...base, ...patch }), k, JSON.stringify(patch));
  }
});

test('meetingPayload e toIsoLocal: horário local vira timestamptz; tipo inválido vira Alinhamento', () => {
  const iso = P.toIsoLocal(new Date(2026, 10, 6).toISOString(), '18:30');
  const d = new Date(iso);
  assert.equal(d.getHours(), 18); assert.equal(d.getMinutes(), 30); assert.equal(d.getDate(), 6);
  const p = P.meetingPayload({ type: 'Expansão', subject: 's', time: '09:00', briefing: 'b', meetUrl: 'https://meet.google.com/x' }, U1);
  assert.equal(p.meeting_type, 'Alinhamento'); assert.equal(p.company_id, U1); assert.equal(p.ai_briefing, 'b');
  assert.equal(P.meetingPayload({ subject: '', time: '09:00' }, U1).subject, 'Reunião');
});

test('eventOnDay: por data real (banco) e por dia fixo (demonstração)', () => {
  const real = { date: new Date(2026, 11, 3, 10, 0).toISOString() };
  assert.equal(P.eventOnDay(real, 3, 11, 2026), true);
  assert.equal(P.eventOnDay(real, 3, 10, 2026), false);
  assert.equal(P.eventOnDay(real, 3, 11, 2027), false);
  const demo = { day: 6 };
  assert.equal(P.eventOnDay(demo, 6, 10, 2026), true);
  assert.equal(P.eventOnDay(demo, 6, 11, 2026), false);
});

test('derivedKpis: só calcula o que existe; sem métricas vira traço', () => {
  const k = P.derivedKpis([
    { eligibleLives: 1000, activeLives: 800, totalSavings: 40000, mrr: 10000, daysToRenewal: 30 },
    { eligibleLives: 500, activeLives: 100, totalSavings: 8000, mrr: 5000, daysToRenewal: 91 },
    { eligibleLives: 0, activeLives: 0, totalSavings: 0, mrr: 2000, daysToRenewal: 10 }
  ]);
  assert.equal(k.adoption, '60.0%'); // 900 / 1500, ignorando a empresa sem métricas
  assert.equal(k.savings, 'R$ 48.0k');
  assert.equal(k.renewalMrr, 'R$ 12.0k'); // 10000 + 2000 (<= 90 dias)
  const vazio = P.derivedKpis([]);
  assert.equal(vazio.adoption, '—'); assert.equal(vazio.savings, '—');
});

test('monthlyTrend: média por mês, ordem cronológica, no máximo 6 meses', () => {
  const snaps = [
    { recorded_at: '2026-09-30', health_score: 60 }, { recorded_at: '2026-09-01', health_score: 80 },
    { recorded_at: '2026-10-15', health_score: 70 }
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(P.monthlyTrend(snaps))), [{ label: 'Set/26', avg: 70 }, { label: 'Out/26', avg: 70 }]);
  const many = Array.from({ length: 9 }, (_, i) => ({ recorded_at: `2026-${String(i + 1).padStart(2, '0')}-10`, health_score: 50 + i }));
  const t = P.monthlyTrend(many);
  assert.equal(t.length, 6); assert.equal(t[0].label, 'Abr/26'); assert.equal(t[5].avg, 58);
  assert.equal(P.monthlyTrend([]).length, 0);
});

test('mapCompany traz NPS, inadimplência, fatores de risco e se o score já foi calculado', () => {
  const row = { id: U1, name: 'A', health_score: 40, health_status: 'red', nps_score: '6.5', has_overdue_invoice: true,
    risk_factors: ['f1', 'f2'], health_computed_at: '2026-11-06T10:00:00Z', renewal_date: '2026-12-01' };
  const c = P.mapCompany(row, null, new Date(2026, 10, 6));
  assert.equal(c.npsScore, 6.5); assert.equal(c.overdue, true); assert.deepEqual(JSON.parse(JSON.stringify(c.riskFactors)), ['f1', 'f2']); assert.equal(c.healthComputed, true);
  const none = P.mapCompany({ ...row, nps_score: null, risk_factors: null, health_computed_at: null, has_overdue_invoice: null }, null, new Date());
  assert.equal(none.npsScore, null); assert.equal(none.overdue, false); assert.equal(none.riskFactors.length, 0); assert.equal(none.healthComputed, false);
});
