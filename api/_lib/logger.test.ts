import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logStructured, sanitizeValue } from './logger.js';

test('logger estruturado: higienização remove e-mails, telefones e payloads brutos', () => {
  const dirty = {
    email: 'cliente@empresa.com.br',
    phone: '+55 (11) 99999-8888',
    whatsapp: '5511999997777',
    payload: { dados_secretos: 123 },
    body: 'corpo cru',
    company_id: 'c123',
    status: 'ok',
    nested: {
      user_email: 'outro@teste.com',
      contact_phone: '11988887777',
      safe_note: 'Contato realizado com sucesso'
    }
  };

  const clean = sanitizeValue(dirty) as Record<string, any>;
  assert.equal(clean.email, '[REDACTED]');
  assert.equal(clean.phone, '[REDACTED]');
  assert.equal(clean.whatsapp, '[REDACTED]');
  assert.equal(clean.payload, '[REDACTED]');
  assert.equal(clean.body, '[REDACTED]');
  assert.equal(clean.company_id, 'c123');
  assert.equal(clean.status, 'ok');
  assert.equal(clean.nested.user_email, '[EMAIL_REDACTED]');
  assert.equal(clean.nested.contact_phone, '[PHONE_REDACTED]');
  assert.equal(clean.nested.safe_note, 'Contato realizado com sucesso');
});

test('logger estruturado: emite JSON com level, route, id e timestamp', () => {
  const originalLog = console.log;
  let captured = '';
  console.log = (line: string) => { captured = line; };

  try {
    logStructured({
      level: 'info',
      route: 'api/cron/drain-events',
      id: 'batch_42',
      message: 'Lote de eventos processado',
      meta: { done: 10, retried: 0 }
    });

    assert.ok(captured.length > 0);
    const parsed = JSON.parse(captured);
    assert.equal(parsed.level, 'info');
    assert.equal(parsed.route, 'api/cron/drain-events');
    assert.equal(parsed.id, 'batch_42');
    assert.equal(parsed.message, 'Lote de eventos processado');
    assert.deepEqual(parsed.meta, { done: 10, retried: 0 });
    assert.ok(parsed.timestamp);
  } finally {
    console.log = originalLog;
  }
});
