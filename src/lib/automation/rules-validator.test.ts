import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRuleInput } from './rules-validator.js';

test('validador de regras: aceita regra completa e bem formada', () => {
  process.env.AUTOMATION_HTTP_ALLOWLIST = 'api.pulsecs.com, hooks.slack.com';

  const validRule = {
    name: 'Alerta de Risco para Contas Enterprise',
    trigger_event: 'company.health_changed',
    is_active: true,
    conditions: [
      { field: 'company.health_score', op: 'lt', value: '50' },
      { field: 'company.tier', op: 'eq', value: 'Enterprise' }
    ],
    actions: [
      {
        type: 'create_task',
        config: {
          title: 'Contatar patrocinador da conta {{company.name}}',
          severity: 'critical',
          body: 'Score caiu para {{company.health_score}}. Agendar reunião de alinhamento.'
        }
      },
      {
        type: 'add_note',
        config: {
          content: 'Automação disparou alerta de saúde crítica.'
        }
      },
      {
        type: 'http_request',
        config: {
          url: 'https://hooks.slack.com/services/T00/B00/X00',
          method: 'POST',
          body: { text: 'Alerta de risco' }
        }
      },
      {
        type: 'delay',
        config: { days: 2, hours: 12 }
      },
      {
        type: 'if',
        config: {
          conditions: [{ field: 'company.health_status', op: 'eq', value: 'red' }],
          then: [
            {
              type: 'create_task',
              config: { title: 'Follow-up de risco persistente', severity: 'critical' }
            }
          ],
          else: [
            {
              type: 'add_note',
              config: { content: 'Saúde recuperada após espera.' }
            }
          ]
        }
      }
    ]
  };

  const res = validateRuleInput(validRule);
  assert.equal(res.valid, true, `Esperava válido mas falhou: ${res.errors.join(', ')}`);
  assert.equal(res.data?.name, validRule.name);
  assert.equal(res.data?.actions.length, 5);
  assert.equal(res.data?.conditions.length, 2);
});

test('validador de regras: rejeita nome ausente, vazio ou longo demais', () => {
  assert.equal(validateRuleInput({}).valid, false);
  assert.equal(validateRuleInput({ name: '   ', trigger_event: 'company.created', actions: [{ type: 'create_task', config: { title: 'T' } }] }).valid, false);
  assert.equal(validateRuleInput({ name: 'a'.repeat(101), trigger_event: 'company.created', actions: [{ type: 'create_task', config: { title: 'T' } }] }).valid, false);
});

test('validador de regras: rejeita gatilhos inválidos ou desconhecidos', () => {
  const base = { name: 'Regra', actions: [{ type: 'create_task', config: { title: 'T' } }] };
  assert.equal(validateRuleInput({ ...base, trigger_event: 'hack.trigger' }).valid, false);
  assert.equal(validateRuleInput({ ...base, trigger_event: '' }).valid, false);
});

test('validador de regras: valida condições e operadores', () => {
  const base = { name: 'Regra', trigger_event: 'company.created', actions: [{ type: 'create_task', config: { title: 'T' } }] };

  // Operador inválido
  const invOp = validateRuleInput({ ...base, conditions: [{ field: 'score', op: 'bad_op', value: '10' }] });
  assert.equal(invOp.valid, false);
  assert.match(invOp.errors[0], /op inválido/);

  // Campo com caracteres proibidos
  const invField = validateRuleInput({ ...base, conditions: [{ field: 'score; DROP TABLE', op: 'eq', value: '1' }] });
  assert.equal(invField.valid, false);
  assert.match(invField.errors[0], /field inválido/);
});

test('validador de regras: valida create_task e add_note', () => {
  const base = { name: 'Regra', trigger_event: 'company.created' };

  // create_task sem título
  const noTitle = validateRuleInput({ ...base, actions: [{ type: 'create_task', config: { title: '  ' } }] });
  assert.equal(noTitle.valid, false);
  assert.match(noTitle.errors[0], /título da tarefa é obrigatório/);

  // add_note sem conteúdo
  const noNote = validateRuleInput({ ...base, actions: [{ type: 'add_note', config: { content: '' } }] });
  assert.equal(noNote.valid, false);
  assert.match(noNote.errors[0], /conteúdo da nota é obrigatório/);
});

test('validador de regras: proteção SSRF em http_request', () => {
  process.env.AUTOMATION_HTTP_ALLOWLIST = 'api.parceiro.com';
  const base = { name: 'Regra', trigger_event: 'company.created' };

  // Não HTTPS
  const httpNotHttps = validateRuleInput({ ...base, actions: [{ type: 'http_request', config: { url: 'http://api.parceiro.com/test' } }] });
  assert.equal(httpNotHttps.valid, false);
  assert.match(httpNotHttps.errors[0], /protocolo deve ser HTTPS/);

  // IP literal
  const ipUrl = validateRuleInput({ ...base, actions: [{ type: 'http_request', config: { url: 'https://192.168.1.1/test' } }] });
  assert.equal(ipUrl.valid, false);
  assert.match(ipUrl.errors[0], /host não permitido/);

  // Localhost
  const localUrl = validateRuleInput({ ...base, actions: [{ type: 'http_request', config: { url: 'https://localhost/test' } }] });
  assert.equal(localUrl.valid, false);
  assert.match(localUrl.errors[0], /host não permitido/);

  // Credenciais na URL
  const credUrl = validateRuleInput({ ...base, actions: [{ type: 'http_request', config: { url: 'https://user:pass@api.parceiro.com/test' } }] });
  assert.equal(credUrl.valid, false);
  assert.match(credUrl.errors[0], /credenciais na URL/);

  // Host fora da allowlist
  const foraAllowlist = validateRuleInput({ ...base, actions: [{ type: 'http_request', config: { url: 'https://evil.com/test' } }] });
  assert.equal(foraAllowlist.valid, false);
  assert.match(foraAllowlist.errors[0], /não consta na allowlist/);
});

test('validador de regras: rejeita delay dentro de ramos if/else e valida limites de tempo', () => {
  const base = { name: 'Regra', trigger_event: 'company.created' };

  // Delay dentro de if
  const delayInIf = validateRuleInput({
    ...base,
    actions: [
      {
        type: 'if',
        config: {
          conditions: [],
          then: [{ type: 'delay', config: { days: 1 } }]
        }
      }
    ]
  });
  assert.equal(delayInIf.valid, false);
  assert.match(delayInIf.errors[0], /delay só é permitido no nível raiz/);

  // Delay com tempo zero ou negativo
  const delayZero = validateRuleInput({ ...base, actions: [{ type: 'delay', config: { days: 0, hours: 0 } }] });
  assert.equal(delayZero.valid, false);
  assert.match(delayZero.errors[0], /espera de delay deve ser maior que 0/);

  // Delay acima de 90 dias
  const delayOver = validateRuleInput({ ...base, actions: [{ type: 'delay', config: { days: 91 } }] });
  assert.equal(delayOver.valid, false);
  assert.match(delayOver.errors[0], /espera máxima de delay é de 90 dias/);
});

test('validador de regras: limita profundidade de if/else e total de ações', () => {
  const base = { name: 'Regra', trigger_event: 'company.created' };

  // Profundidade 4 (> 3)
  const deepIf = {
    type: 'if',
    config: {
      conditions: [],
      then: [
        {
          type: 'if',
          config: {
            conditions: [],
            then: [
              {
                type: 'if',
                config: {
                  conditions: [],
                  then: [
                    {
                      type: 'if',
                      config: {
                        conditions: [],
                        then: [{ type: 'add_note', config: { content: 'Muito fundo' } }]
                      }
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    }
  };

  const resDeep = validateRuleInput({ ...base, actions: [deepIf] });
  assert.equal(resDeep.valid, false);
  assert.match(resDeep.errors.join(' '), /profundidade máxima de if\/else atingida/);
});
