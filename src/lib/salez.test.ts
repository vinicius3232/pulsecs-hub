import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliveryKey, parseDeal, processDeal, tierFor, type Deal, type SalezDb } from './salez.js';

const deal = (over: Partial<Deal> = {}): Deal => ({ name: 'Acme Benefícios', mrr: 9000, contactName: 'Ana', email: 'ana@acme.com', phone: '5511999999999', dealId: null, ...over });

/** Banco em memória: claim é atômico (como a UNIQUE do Postgres), com pontos de espera para provocar corrida. */
function memDb(opts: { failCompanyTimes?: number; failContact?: boolean } = {}) {
  const claims = new Map<string, string | null>();
  const companies: Array<{ id: string; name: string; mrr: number; tier: string }> = [];
  const contacts: unknown[] = [];
  let failures = opts.failCompanyTimes ?? 0;
  const db: SalezDb = {
    async claim(source, key) {
      const k = source + '|' + key;
      if (claims.has(k)) return 'duplicate';
      claims.set(k, null); // síncrono: duas chamadas simultâneas nunca passam as duas
      await Promise.resolve();
      return 'claimed';
    },
    async release(source, key) { claims.delete(source + '|' + key); },
    async complete(source, key, companyId) { claims.set(source + '|' + key, companyId); },
    async insertCompany(c) {
      await new Promise(r => setTimeout(r, 2)); // demora de rede: deixa as outras requisições chegarem
      if (failures > 0) { failures--; throw new Error('banco indisponível'); }
      const row = { id: 'co' + (companies.length + 1), ...c };
      companies.push(row);
      return { id: row.id };
    },
    async insertContact(c) {
      if (opts.failContact) throw new Error('contato recusado');
      contacts.push(c);
    }
  };
  return { db, claims, companies, contacts };
}

test('parseDeal: aceita variações de campo e higieniza', () => {
  const r = parseDeal({ company_name: '  Acme  ', deal_value: '9500.5', contact_name: 'Ana', email: 'ANA@ACME.COM', whatsapp: '+55 (11) 99999-9999', id: 4711 });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.deal.name, 'Acme'); assert.equal(r.deal.mrr, 9500.5); assert.equal(r.deal.email, 'ana@acme.com');
    assert.equal(r.deal.phone, '5511999999999'); assert.equal(r.deal.dealId, '4711');
  }
  const semEmail = parseDeal({ company_name: 'X', mrr: 1, email: 'nao-e-email' });
  assert.ok(semEmail.ok && semEmail.deal.email === '' && semEmail.deal.contactName === 'Responsável');
});

test('parseDeal: recusa corpo inválido, sem nome e valores absurdos', () => {
  for (const [raw, why] of [[null, /inválido/], [[], /inválido/], [{ mrr: 1 }, /company_name/], [{ company_name: 'X', mrr: -1 }, /mrr/], [{ company_name: 'X', mrr: 'abc' }, /mrr/], [{ company_name: 'X', mrr: 1e12 }, /mrr/]] as const) {
    const r = parseDeal(raw);
    assert.ok(!r.ok); if (!r.ok) assert.match(r.reason, why as RegExp);
  }
});

test('deliveryKey: deal_id manda; sem ele, hash estável (caixa, acento e espaços não importam)', () => {
  assert.equal(deliveryKey(deal({ dealId: '77' })), 'deal:77');
  const a = deliveryKey(deal({ name: 'Acme Benefícios' }));
  const b = deliveryKey(deal({ name: '  ACME   beneficios ' }));
  assert.equal(a, b);
  assert.ok(a.startsWith('hash:'));
});

test('homônimos com contatos diferentes NÃO colidem (o bug da deduplicação por nome)', () => {
  assert.notEqual(deliveryKey(deal({ email: 'ana@acme.com' })), deliveryKey(deal({ email: 'bruno@acme.com' })));
  assert.notEqual(deliveryKey(deal({ phone: '5511111111111' })), deliveryKey(deal({ phone: '5522222222222' })));
  assert.notEqual(deliveryKey(deal({ dealId: '1' })), deliveryKey(deal({ dealId: '2' })));
});

test('criação normal: empresa em tier certo, contato vinculado, entrega concluída', async () => {
  const m = memDb();
  const r = await processDeal(m.db, deal({ mrr: 13000, dealId: '9' }));
  assert.equal(r.status, 'created');
  assert.equal(m.companies.length, 1); assert.equal(m.companies[0].tier, 'Enterprise');
  assert.equal(m.contacts.length, 1);
  assert.equal(m.claims.get('salez|deal:9'), m.companies[0].id);
  assert.deepEqual([tierFor(5999), tierFor(6000), tierFor(11999), tierFor(12000)], ['SMB', 'Mid-Market', 'Mid-Market', 'Enterprise']);
});

test('reenvio sequencial: segunda entrega é duplicada e não cria nada', async () => {
  const m = memDb();
  assert.equal((await processDeal(m.db, deal({ dealId: '5' }))).status, 'created');
  assert.equal((await processDeal(m.db, deal({ dealId: '5' }))).status, 'duplicate');
  assert.equal(m.companies.length, 1);
});

test('CONCORRÊNCIA: 12 entregas simultâneas do mesmo negócio criam UMA empresa', async () => {
  const m = memDb();
  const results = await Promise.all(Array.from({ length: 12 }, () => processDeal(m.db, deal({ dealId: 'same' }))));
  assert.equal(results.filter(r => r.status === 'created').length, 1);
  assert.equal(results.filter(r => r.status === 'duplicate').length, 11);
  assert.equal(m.companies.length, 1);
});

test('CONCORRÊNCIA sem deal_id: mesmo nome+contato simultâneo cria UMA; homônimos diferentes criam DUAS', async () => {
  const m = memDb();
  const mesmos = await Promise.all(Array.from({ length: 6 }, () => processDeal(m.db, deal())));
  assert.equal(mesmos.filter(r => r.status === 'created').length, 1);
  assert.equal(m.companies.length, 1);

  const m2 = memDb();
  await Promise.all([processDeal(m2.db, deal({ email: 'a@x.com' })), processDeal(m2.db, deal({ email: 'b@x.com' }))]);
  assert.equal(m2.companies.length, 2); // mesmo nome, negócios diferentes
});

test('falha ao criar a empresa libera a reserva: a Salez reenvia e funciona', async () => {
  const m = memDb({ failCompanyTimes: 1 });
  await assert.rejects(() => processDeal(m.db, deal({ dealId: 'r' })), /banco indisponível/);
  assert.equal(m.claims.size, 0);          // reserva liberada
  assert.equal(m.companies.length, 0);
  assert.equal((await processDeal(m.db, deal({ dealId: 'r' }))).status, 'created'); // reenvio passa
  assert.equal(m.companies.length, 1);
});

test('falha só no contato não desfaz a empresa nem permite duplicar no reenvio', async () => {
  const m = memDb({ failContact: true });
  const r = await processDeal(m.db, deal({ dealId: 'c' }));
  assert.equal(r.status, 'created');
  assert.equal(m.companies.length, 1); assert.equal(m.contacts.length, 0);
  assert.equal((await processDeal(m.db, deal({ dealId: 'c' }))).status, 'duplicate');
  assert.equal(m.companies.length, 1);
});

test('sem e-mail válido a empresa é criada sem contato', async () => {
  const m = memDb();
  await processDeal(m.db, deal({ email: '', dealId: 'n' }));
  assert.equal(m.companies.length, 1); assert.equal(m.contacts.length, 0);
});
