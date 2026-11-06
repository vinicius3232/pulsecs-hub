export type EventStatus = 'pending' | 'processing' | 'done' | 'dead';

export interface EventRow {
  id: string;
  event_type: string;
  entity_kind: string;
  entity_id: string | null;
  company_id: string | null;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  external_id: string | null;
  status: EventStatus;
  attempts: number;
}

export type ConditionOp = 'eq' | 'neq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte';

export interface RuleCondition {
  field: string;
  op: ConditionOp;
  value: string;
}

/**
 * Passos suportados (config por tipo):
 *  - create_task   { title, body?, severity? }
 *  - add_note      { content }                      grava na linha do tempo (interactions)
 *  - http_request  { url, method?, body? }          só hosts em AUTOMATION_HTTP_ALLOWLIST
 *  - delay         { days?, hours? }                só no nível raiz; retoma no cron
 *  - if            { conditions, then, else? }      ramos aceitam os demais passos (sem delay)
 */
export interface ActionSpec {
  type: string;
  config?: Record<string, unknown>;
}

export interface RuleRow {
  id: string;
  name: string;
  conditions: RuleCondition[];
  actions: ActionSpec[];
  is_active?: boolean;
}

export type ActionStatus = 'done' | 'duplicate' | 'skipped' | 'failed' | 'scheduled';

export interface ActionResult {
  type: string;
  status: ActionStatus;
  detail?: string;
}

export type RunStatus = 'success' | 'partial' | 'failed' | 'waiting';

export interface HandlerResult {
  status: 'ok' | 'skipped' | 'error';
  detail?: string;
}

export type Severity = 'info' | 'warn' | 'critical';

export interface NewTask {
  companyId: string | null;
  csmId: string | null;
  ruleId: string | null;
  title: string;
  body: string | null;
  severity: Severity;
  dedupeKey: string | null;
}

export interface NewNote {
  companyId: string;
  csmId: string | null;
  content: string;
}

export interface ScheduledStep {
  id: string;
  rule_id: string;
  event_id: string;
  company_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  next_index: number;
  attempts: number;
}

export interface NewScheduledStep {
  ruleId: string;
  eventId: string;
  companyId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  nextIndex: number;
  resumeAt: string;
}

/**
 * Porta de persistência do motor. A implementação real fala com o Supabase
 * (`supabase-store.ts`); os testes usam uma em memória.
 */
export interface AutomationStore {
  activeRulesFor(eventType: string): Promise<RuleRow[]>;
  ruleById(id: string): Promise<RuleRow | null>;
  /** Linha da empresa + campos derivados (ex.: activation_rate). */
  companyContext(companyId: string): Promise<Record<string, unknown> | null>;
  /** Devolve 'duplicate' se já existir tarefa aberta com o mesmo dedupeKey. */
  createTask(task: NewTask): Promise<'created' | 'duplicate'>;
  addNote(note: NewNote): Promise<void>;
  /** Cria (ou atualiza, se o par regra+evento já existe) o registro da execução. */
  recordRun(run: { ruleId: string; eventId: string; status: RunStatus; actions: ActionResult[] }): Promise<void>;
  getRunActions(ruleId: string, eventId: string): Promise<ActionResult[]>;
  /** Idempotente por (regra, evento, passo): reprocessar o evento não duplica a espera. */
  scheduleResume(step: NewScheduledStep): Promise<'scheduled' | 'duplicate'>;
  claimDueScheduled(limit: number): Promise<ScheduledStep[]>;
  finishScheduled(id: string, status: 'done' | 'failed' | 'cancelled', error?: string): Promise<void>;
  retryScheduled(id: string, resumeAt: string, error: string): Promise<void>;
}
