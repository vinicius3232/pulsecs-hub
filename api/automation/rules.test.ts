import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from './rules.js';

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  data: unknown;
  res: VercelResponse;
}

function mockRes(): MockResponse {
  const out: MockResponse = {
    statusCode: 200,
    headers: {},
    data: null,
    res: {} as VercelResponse
  };

  out.res.status = (code: number) => {
    out.statusCode = code;
    return out.res;
  };

  out.res.setHeader = (k: string, v: string | number | readonly string[]) => {
    out.headers[k.toLowerCase()] = String(v);
    return out.res;
  };

  out.res.json = (body: unknown) => {
    out.data = body;
    return out.res;
  };

  out.res.end = () => out.res;

  return out;
}

test('api/automation/rules: rejeita métodos não permitidos com 405', async () => {
  const r = mockRes();
  const req = {
    method: 'GET',
    headers: {}
  } as unknown as VercelRequest;

  await handler(req, r.res);
  assert.equal(r.statusCode, 405);
  assert.equal(r.headers['allow'], 'POST, PUT, DELETE');
  assert.deepEqual(r.data, { error: 'Method Not Allowed' });
});

test('api/automation/rules: rejeita requisição sem token com 401', async () => {
  const r = mockRes();
  const req = {
    method: 'POST',
    headers: {}
  } as unknown as VercelRequest;

  await handler(req, r.res);
  assert.equal(r.statusCode, 401);
  assert.deepEqual(r.data, { error: 'Unauthorized' });
});

test('api/automation/rules: bloqueia quem não é Head (403)', async () => {
  process.env.SUPABASE_URL = 'https://fake-sb.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'fake-anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service';

  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u.includes('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: 'user-csm-123' }), { status: 200 });
      }
      if (u.includes('/rest/v1/csm_users')) {
        // Usuário existe mas tem papel 'csm' (não é 'head')
        return new Response(JSON.stringify([{ id: 'csm-1', role: 'csm', is_active: true }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const r = mockRes();
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token-csm-valido' },
      body: { name: 'Regra Inválida' }
    } as unknown as VercelRequest;

    await handler(req, r.res);
    assert.equal(r.statusCode, 403);
    assert.match((r.data as { error: string }).error, /Forbidden/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('api/automation/rules: validação no servidor rejeita regra com dados inválidos (400)', async () => {
  process.env.SUPABASE_URL = 'https://fake-sb.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'fake-anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service';

  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u.includes('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: 'user-head-123' }), { status: 200 });
      }
      if (u.includes('/rest/v1/csm_users')) {
        return new Response(JSON.stringify([{ id: 'head-1', role: 'head', is_active: true }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const r = mockRes();
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token-head-valido' },
      body: {
        name: '', // Inválido: nome vazio
        trigger_event: 'company.invalid_trigger', // Inválido
        actions: [] // Inválido: sem ações
      }
    } as unknown as VercelRequest;

    await handler(req, r.res);
    assert.equal(r.statusCode, 400);
    const d = r.data as { error: string; details: string[] };
    assert.equal(d.error, 'Regra inválida');
    assert.ok(d.details.length >= 3);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('api/automation/rules: PUT e DELETE exigem UUID válido (400)', async () => {
  process.env.SUPABASE_URL = 'https://fake-sb.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'fake-anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service';

  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u.includes('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: 'user-head-123' }), { status: 200 });
      }
      if (u.includes('/rest/v1/csm_users')) {
        return new Response(JSON.stringify([{ id: 'head-1', role: 'head', is_active: true }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const rPut = mockRes();
    const reqPut = {
      method: 'PUT',
      headers: { authorization: 'Bearer token-head' },
      query: { id: 'nao-e-uuid' },
      body: { name: 'Regra' }
    } as unknown as VercelRequest;

    await handler(reqPut, rPut.res);
    assert.equal(rPut.statusCode, 400);
    assert.match((rPut.data as { error: string }).error, /UUID/);

    const rDel = mockRes();
    const reqDel = {
      method: 'DELETE',
      headers: { authorization: 'Bearer token-head' },
      query: { id: 'bad-id' }
    } as unknown as VercelRequest;

    await handler(reqDel, rDel.res);
    assert.equal(rDel.statusCode, 400);
    assert.match((rDel.data as { error: string }).error, /UUID/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
