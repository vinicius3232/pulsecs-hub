import { allowedHttpHosts } from './actions.js';
import type { ActionSpec, ConditionOp, RuleCondition, Severity } from './types.js';

export const VALID_TRIGGERS = [
  'company.created',
  'company.health_changed',
  'company.phase_changed',
  'company.renewal_due',
  'company.rh_inactive',
  'manual.run'
] as const;

export const VALID_OPS: readonly ConditionOp[] = ['eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte'];
export const VALID_SEVERITIES: readonly Severity[] = ['info', 'warn', 'critical'];

export const MAX_RULE_NAME_LEN = 100;
export const MAX_CONDITIONS_COUNT = 10;
export const MAX_ROOT_ACTIONS = 10;
export const MAX_TOTAL_ACTIONS = 15;
export const MAX_IF_DEPTH = 3;
export const MAX_TASK_TITLE_LEN = 200;
export const MAX_TASK_BODY_LEN = 1000;
export const MAX_NOTE_CONTENT_LEN = 2000;
export const MAX_HTTP_URL_LEN = 500;
export const MAX_HTTP_BODY_LEN = 2000;
export const MAX_DELAY_MS = 90 * 24 * 60 * 60 * 1000;

const IPV4_REGEX = /^\d{1,3}(\.\d{1,3}){3}$/;
const FIELD_PATH_REGEX = /^[a-zA-Z0-9_.]+$/;

export interface ValidatedRulePayload {
  name: string;
  trigger_event: string;
  conditions: RuleCondition[];
  actions: ActionSpec[];
  is_active: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  data?: ValidatedRulePayload;
}

function validateConditions(rawConditions: unknown, prefix = 'conditions'): { valid: boolean; errors: string[]; conditions: RuleCondition[] } {
  const errors: string[] = [];
  if (!Array.isArray(rawConditions)) {
    return { valid: false, errors: [`${prefix} deve ser um array`], conditions: [] };
  }
  if (rawConditions.length > MAX_CONDITIONS_COUNT) {
    errors.push(`${prefix} não pode ter mais de ${MAX_CONDITIONS_COUNT} itens`);
  }

  const sanitized: RuleCondition[] = [];
  for (let i = 0; i < rawConditions.length; i++) {
    const c = rawConditions[i];
    const loc = `${prefix}[${i}]`;
    if (!c || typeof c !== 'object') {
      errors.push(`${loc} deve ser um objeto`);
      continue;
    }

    const field = String((c as Record<string, unknown>).field ?? '').trim();
    const op = String((c as Record<string, unknown>).op ?? '').trim() as ConditionOp;
    const value = String((c as Record<string, unknown>).value ?? '').trim();

    if (!field || field.length > 60 || !FIELD_PATH_REGEX.test(field)) {
      errors.push(`${loc}.field inválido (máx 60 caracteres alfanuméricos com ponto)`);
    }
    if (!VALID_OPS.includes(op)) {
      errors.push(`${loc}.op inválido (operadores suportados: ${VALID_OPS.join(', ')})`);
    }
    if (value.length > 100) {
      errors.push(`${loc}.value excede o tamanho máximo de 100 caracteres`);
    }

    sanitized.push({ field, op, value });
  }

  return { valid: errors.length === 0, errors, conditions: sanitized };
}

function validateAction(
  step: unknown,
  loc: string,
  isRoot: boolean,
  depth: number,
  state: { totalActions: number }
): { valid: boolean; errors: string[]; action?: ActionSpec } {
  const errors: string[] = [];
  if (!step || typeof step !== 'object') {
    return { valid: false, errors: [`${loc} deve ser um objeto`] };
  }

  state.totalActions++;
  if (state.totalActions > MAX_TOTAL_ACTIONS) {
    errors.push(`Número total de ações na regra excede o limite de ${MAX_TOTAL_ACTIONS}`);
    return { valid: false, errors };
  }

  const s = step as Record<string, unknown>;
  const type = String(s.type ?? '').trim();
  const config = (s.config && typeof s.config === 'object') ? (s.config as Record<string, unknown>) : {};

  switch (type) {
    case 'create_task': {
      const rawTitle = typeof config.title === 'string' ? config.title.trim() : '';
      if (!rawTitle) {
        errors.push(`${loc}: título da tarefa é obrigatório`);
      } else if (rawTitle.length > MAX_TASK_TITLE_LEN) {
        errors.push(`${loc}: título da tarefa excede ${MAX_TASK_TITLE_LEN} caracteres`);
      }

      let body: string | undefined;
      if (config.body !== undefined && config.body !== null) {
        if (typeof config.body !== 'string') {
          errors.push(`${loc}: corpo da tarefa deve ser texto`);
        } else if (config.body.length > MAX_TASK_BODY_LEN) {
          errors.push(`${loc}: corpo da tarefa excede ${MAX_TASK_BODY_LEN} caracteres`);
        } else {
          body = config.body;
        }
      }

      let severity: Severity = 'warn';
      if (config.severity !== undefined && config.severity !== null) {
        if (!VALID_SEVERITIES.includes(config.severity as Severity)) {
          errors.push(`${loc}: severidade inválida (opções: ${VALID_SEVERITIES.join(', ')})`);
        } else {
          severity = config.severity as Severity;
        }
      }

      return {
        valid: errors.length === 0,
        errors,
        action: { type: 'create_task', config: { title: rawTitle, ...(body !== undefined ? { body } : {}), severity } }
      };
    }

    case 'add_note': {
      const content = typeof config.content === 'string' ? config.content.trim() : '';
      if (!content) {
        errors.push(`${loc}: conteúdo da nota é obrigatório`);
      } else if (content.length > MAX_NOTE_CONTENT_LEN) {
        errors.push(`${loc}: conteúdo da nota excede ${MAX_NOTE_CONTENT_LEN} caracteres`);
      }

      return {
        valid: errors.length === 0,
        errors,
        action: { type: 'add_note', config: { content } }
      };
    }

    case 'http_request': {
      const rawUrl = typeof config.url === 'string' ? config.url.trim() : '';
      if (!rawUrl) {
        errors.push(`${loc}: URL é obrigatória`);
      } else if (rawUrl.length > MAX_HTTP_URL_LEN) {
        errors.push(`${loc}: URL excede ${MAX_HTTP_URL_LEN} caracteres`);
      } else {
        // Validação SSRF alinhada com actions.ts
        let urlObj: URL | null = null;
        try {
          // Permite interpolações {{...}} substituindo temporariamente por 'placeholder' para validação de URL
          urlObj = new URL(rawUrl.replace(/\{\{[^}]*\}\}/g, 'x'));
        } catch {
          errors.push(`${loc}: URL inválida`);
        }

        if (urlObj) {
          const host = urlObj.hostname.toLowerCase();
          if (urlObj.protocol !== 'https:') {
            errors.push(`${loc}: protocolo deve ser HTTPS`);
          }
          if (urlObj.username || urlObj.password) {
            errors.push(`${loc}: credenciais na URL não são permitidas`);
          }
          if (IPV4_REGEX.test(host) || host.includes(':') || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
            errors.push(`${loc}: host não permitido por segurança`);
          }

          const allowlist = allowedHttpHosts();
          if (!allowlist.includes(host)) {
            errors.push(`${loc}: host "${host}" não consta na allowlist de integrações permitidas`);
          }
        }
      }

      const method = config.method === 'GET' ? 'GET' : 'POST';
      let body: unknown;
      if (method === 'POST' && config.body !== undefined) {
        if (typeof config.body === 'string') {
          if (config.body.length > MAX_HTTP_BODY_LEN) {
            errors.push(`${loc}: corpo HTTP excede ${MAX_HTTP_BODY_LEN} caracteres`);
          }
          body = config.body;
        } else if (typeof config.body === 'object' && config.body !== null) {
          const str = JSON.stringify(config.body);
          if (str.length > MAX_HTTP_BODY_LEN) {
            errors.push(`${loc}: payload JSON excede ${MAX_HTTP_BODY_LEN} caracteres`);
          }
          body = config.body;
        }
      }

      return {
        valid: errors.length === 0,
        errors,
        action: { type: 'http_request', config: { url: rawUrl, method, ...(body !== undefined ? { body } : {}) } }
      };
    }

    case 'delay': {
      if (!isRoot) {
        errors.push(`${loc}: delay só é permitido no nível raiz da regra (nunca dentro de if/else)`);
      }

      const days = Number(config.days ?? 0);
      const hours = Number(config.hours ?? 0);
      if (!Number.isFinite(days) || !Number.isFinite(hours) || days < 0 || hours < 0) {
        errors.push(`${loc}: dias e horas devem ser números finitos não-negativos`);
      } else {
        const ms = days * 86_400_000 + hours * 3_600_000;
        if (ms <= 0) {
          errors.push(`${loc}: espera de delay deve ser maior que 0`);
        } else if (ms > MAX_DELAY_MS) {
          errors.push(`${loc}: espera máxima de delay é de 90 dias`);
        }
      }

      return {
        valid: errors.length === 0,
        errors,
        action: { type: 'delay', config: { days, hours } }
      };
    }

    case 'if': {
      if (depth >= MAX_IF_DEPTH) {
        errors.push(`${loc}: profundidade máxima de if/else atingida (${MAX_IF_DEPTH})`);
      }

      const condRes = validateConditions(config.conditions ?? [], `${loc}.conditions`);
      errors.push(...condRes.errors);

      const thenSteps = Array.isArray(config.then) ? config.then : [];
      if (thenSteps.length === 0) {
        errors.push(`${loc}: ramo 'then' não pode ser vazio`);
      } else if (thenSteps.length > MAX_ROOT_ACTIONS) {
        errors.push(`${loc}: ramo 'then' excede ${MAX_ROOT_ACTIONS} passos`);
      }

      const validatedThen: ActionSpec[] = [];
      for (let j = 0; j < thenSteps.length; j++) {
        const res = validateAction(thenSteps[j], `${loc}.then[${j}]`, false, depth + 1, state);
        errors.push(...res.errors);
        if (res.action) validatedThen.push(res.action);
      }

      let validatedElse: ActionSpec[] | undefined;
      if (config.else !== undefined && config.else !== null) {
        if (!Array.isArray(config.else)) {
          errors.push(`${loc}: ramo 'else' deve ser um array`);
        } else {
          validatedElse = [];
          for (let k = 0; k < config.else.length; k++) {
            const res = validateAction(config.else[k], `${loc}.else[${k}]`, false, depth + 1, state);
            errors.push(...res.errors);
            if (res.action) validatedElse.push(res.action);
          }
        }
      }

      return {
        valid: errors.length === 0,
        errors,
        action: {
          type: 'if',
          config: {
            conditions: condRes.conditions,
            then: validatedThen,
            ...(validatedElse ? { else: validatedElse } : {})
          }
        }
      };
    }

    default:
      errors.push(`${loc}: tipo de ação desconhecido ou não suportado: "${type}"`);
      return { valid: false, errors };
  }
}

export function validateRuleInput(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') {
    return { valid: false, errors: ['Corpo da requisição deve ser um objeto JSON'] };
  }

  const r = input as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!name) {
    errors.push('Nome da regra é obrigatório');
  } else if (name.length > MAX_RULE_NAME_LEN) {
    errors.push(`Nome da regra excede ${MAX_RULE_NAME_LEN} caracteres`);
  }

  const trigger = typeof r.trigger_event === 'string' ? r.trigger_event.trim() : '';
  if (!trigger) {
    errors.push('Gatilho (trigger_event) é obrigatório');
  } else if (!VALID_TRIGGERS.includes(trigger as typeof VALID_TRIGGERS[number])) {
    errors.push(`Gatilho desconhecido: "${trigger}". Opções válidas: ${VALID_TRIGGERS.join(', ')}`);
  }

  const condRes = validateConditions(r.conditions ?? [], 'conditions');
  errors.push(...condRes.errors);

  const rawActions = r.actions;
  if (!Array.isArray(rawActions)) {
    errors.push('Ações (actions) deve ser um array');
  } else if (rawActions.length === 0) {
    errors.push('A regra deve ter pelo menos uma ação');
  } else if (rawActions.length > MAX_ROOT_ACTIONS) {
    errors.push(`A regra não pode ter mais de ${MAX_ROOT_ACTIONS} ações no nível raiz`);
  }

  const state = { totalActions: 0 };
  const validatedActions: ActionSpec[] = [];
  if (Array.isArray(rawActions)) {
    for (let i = 0; i < rawActions.length; i++) {
      const aRes = validateAction(rawActions[i], `actions[${i}]`, true, 1, state);
      errors.push(...aRes.errors);
      if (aRes.action) validatedActions.push(aRes.action);
    }
  }

  const is_active = r.is_active === undefined ? true : Boolean(r.is_active);

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    data: {
      name,
      trigger_event: trigger,
      conditions: condRes.conditions,
      actions: validatedActions,
      is_active
    }
  };
}
