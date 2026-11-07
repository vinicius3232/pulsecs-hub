// Testes da tela inicial (carteira): indicadores, filtros e os 4 pilares (puro, sem navegador).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const sandbox = {};
sandbox.globalThis = sandbox;
vm.runInNewContext(readFileSync(fileURLToPath(new URL('./today.js', import.meta.url)), 'utf8'), sandbox);
const { buildHome, filterRows, pillars, parseLoginDays, money, STAGE } = sandbox.PulseTodayPure;
const plain = x => JSON.parse(JSON.stringify(x)); // atravessa o realm do vm

// cliente do banco (modo real): sinais vêm dos campos calculados pela camada de dados
const co = (id, name, status, mrr, extra = {}) => ({
  id, name, status, mrr, hs: status === 'red' ? 38 : 80, contact: 'Ana (RH)', email: 'ana@x.com', phone: '5511999999999', phase: 'Go-Live',
  lastLogin: 'Hoje, 10:00', loginDays: 0, overdue: false, contactedThisMonth: true, lastContactDays: 3, growthPct: 5, ...extra
});

test('indicadores: receita só das críticas, verdes com percentual, sem contato no mês', () => {
  const clients = [
    co(1, 'A', 'red', 8000, { contactedThisMonth: false, lastContactDays: null }),
    co(2, 'B', 'red', 4000),
    co(3, 'C', 'yellow', 9999),
    co(4, 'D', 'green', 5000),
    co(5, 'E', 'green', 100, { contactedThisMonth: false, lastContactDays: null })
  ];
  const h = plain(buildHome({ clients, todayEvents: [], nowTime: '09:00', demo: false }));
  assert.equal(h.mrrAtRisk, 12000);
  assert.equal(h.counts.red, 2); assert.equal(h.counts.yellow, 1); assert.equal(h.counts.green, 2); assert.equal(h.counts.all, 5);
  assert.equal(h.greenPct, 40);
  assert.equal(h.counts.nocontact, 2);
  assert.equal(h.total, 5);
});

test('carteira vazia não quebra (sem divisão por zero)', () => {
  const h = plain(buildHome({ clients: [], todayEvents: [], nowTime: '09:00', demo: false }));
  assert.equal(h.total, 0); assert.equal(h.greenPct, 0); assert.equal(h.meetingsToday, 0); assert.equal(h.nextMeeting, null);
});

test('reuniões hoje: conta só as não realizadas e aponta a próxima a partir de agora', () => {
  const ev = [
    { time: '17:00', company: 'NexStore' }, { time: '14:00', company: 'Rede Mais' },
    { time: '15:30', company: 'Clube Prime' }, { time: '08:00', company: 'Já feita', completed: true }
  ];
  const h = plain(buildHome({ clients: [], todayEvents: ev, nowTime: '15:00', demo: false }));
  assert.equal(h.meetingsToday, 3);
  assert.deepEqual(h.nextMeeting, { time: '15:30', company: 'Clube Prime' });
  const late = plain(buildHome({ clients: [], todayEvents: ev, nowTime: '23:00', demo: false }));
  assert.equal(late.nextMeeting, null); // todas passaram
  const demo = plain(buildHome({ clients: [], todayEvents: ev, nowTime: '00:00', demo: true }));
  assert.equal(demo.nextMeeting.time, '14:00'); // demonstração mostra a primeira do dia
});

test('pilares (modo real): login, pagamento, contato e crescimento', () => {
  const p = c => plain(pillars(c, false)).map(x => [x.key, x.ok, x.text]);
  assert.deepEqual(p(co(1, 'ok', 'green', 1, { loginDays: 2, lastContactDays: 4, growthPct: 9 })),
    [['login', true, 'Login 2d'], ['payment', true, 'Pago'], ['contact', true, 'Contato 4d'], ['growth', true, '+9%']]);
  assert.deepEqual(p(co(2, 'ruim', 'red', 1, { loginDays: 12, overdue: true, contactedThisMonth: false, lastContactDays: null, growthPct: -3 })),
    [['login', false, 'Sem login 12d'], ['payment', false, 'Inadimplente'], ['contact', false, 'Sem contato'], ['growth', false, 'Retração']]);
  // limites: 7 dias ainda é verde, 8 vira vermelho; nunca logou = vermelho; sem histórico não é nem verde nem vermelho
  assert.equal(p(co(3, 'x', 'green', 1, { loginDays: 7 }))[0][1], true);
  assert.equal(p(co(3, 'x', 'green', 1, { loginDays: 8 }))[0][1], false);
  assert.deepEqual(p(co(3, 'x', 'green', 1, { loginDays: null }))[0], ['login', false, 'Sem login']);
  assert.deepEqual(p(co(3, 'x', 'green', 1, { growthPct: null }))[3], ['growth', null, 'Sem histórico']);
  assert.deepEqual(p(co(3, 'x', 'green', 1, { growthPct: 0 }))[3], ['growth', true, '+0%']);
});

test('pilares: cliente sem os campos novos cai no texto do último login (compatível com dados antigos)', () => {
  const old = { id: 99, name: 'Velho', status: 'yellow', lastLogin: 'Há 12 dias' };
  const x = plain(pillars(old, false));
  assert.equal(x[0].text, 'Sem login 12d');
  assert.equal(x[2].ok, false); // sem informação de contato = sem contato
  assert.equal(parseLoginDays('Hoje, 11:40'), 0); assert.equal(parseLoginDays('Ontem, 16:30'), 1);
  assert.equal(parseLoginDays('Há 3 dias'), 3); assert.equal(parseLoginDays('Sem registro'), null);
});

test('modo demonstração usa sinais fixos por cliente e não depende do banco', () => {
  const demoClients = [{ id: 2, name: 'Clube Prime', status: 'red', hs: 38, lastLogin: 'Há 12 dias', mrr: 8900, phase: 'Config & Carga' }, { id: 1, name: 'Rede Mais', status: 'green', hs: 82, lastLogin: 'Hoje, 11:40', mrr: 1, phase: 'Treinamento' }];
  const h = plain(buildHome({ clients: demoClients, todayEvents: [], nowTime: '00:00', demo: true }));
  const prime = h.rows.find(r => r.id === 2);
  assert.deepEqual(prime.pillars.map(x => x.text), ['Sem login 12d', 'Inadimplente', 'Sem contato', 'Retração']);
  assert.equal(h.rows.find(r => r.id === 1).contacted, true);
});

test('estágio de onboarding vem da fase interna; fase desconhecida cai em Onboarding', () => {
  assert.equal(STAGE['Kickoff'], 'Onboarding'); assert.equal(STAGE['Config & Carga'], 'Reunião 1');
  assert.equal(STAGE['Treinamento'], 'Reunião 2'); assert.equal(STAGE['Go-Live'], 'Concluído');
  const h = plain(buildHome({ clients: [co(1, 'A', 'green', 1, { phase: 'Fase Nova' })], todayEvents: [], nowTime: '09:00', demo: false }));
  assert.equal(h.rows[0].stage, 'Onboarding');
});

test('filtros e busca: status, sem contato e texto (nome, contato e e-mail)', () => {
  const clients = [
    co(1, 'Alfa Benefícios', 'red', 1, { contactedThisMonth: false, lastContactDays: null, contact: 'Marta', email: 'marta@alfa.com' }),
    co(2, 'Beta', 'yellow', 1, { contact: 'João' }),
    co(3, 'Gama', 'green', 1, { contact: 'Lia', email: 'lia@gama.com' })
  ];
  const rows = buildHome({ clients, todayEvents: [], nowTime: '09:00', demo: false }).rows;
  const ids = (f, q) => plain(filterRows(rows, f, q)).map(r => r.id);
  assert.deepEqual(ids('all', ''), [1, 2, 3]);
  assert.deepEqual(ids('red', ''), [1]); assert.deepEqual(ids('yellow', ''), [2]); assert.deepEqual(ids('green', ''), [3]);
  assert.deepEqual(ids('nocontact', ''), [1]);
  assert.deepEqual(ids('all', 'MARTA'), [1]);            // contato, sem diferenciar maiúsculas
  assert.deepEqual(ids('all', 'gama.com'), [3]);         // e-mail
  assert.deepEqual(ids('red', 'beta'), []);              // filtros se combinam
  assert.deepEqual(ids('all', '   '), [1, 2, 3]);        // só espaços = sem busca
});

test('money abrevia valores', () => {
  assert.equal(money(0), 'R$ 0'); assert.equal(money(950), 'R$ 950'); assert.equal(money(12400), 'R$ 12.4k'); assert.equal(money(250000), 'R$ 250k');
});
