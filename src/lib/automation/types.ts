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

export interface ActionSpec {
  type: string;
  config?: Record<string, unknown>;
}

export interface RuleRow {
  id: string;
  name: string;
  conditions: RuleCondition[];
  actions: ActionSpec[];
}

export type ActionStatus = 'done' | 'duplicate' | 'skipped' | 'failed';

export interface ActionResult {
  type: string;
  status: ActionStatus;
  detail?: string;
}

export type RunStatus = 'success' | 'partial' | 'failed';

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

/**
 * Porta de persistência do motor. A implementação real fala com o Supabase
 * (`supabase-store.ts`); os testes usam uma em memória.
 */
export interface AutomationStore {
  activeRulesFor(eventType: string): Promise<RuleRow[]>;
  /** Linha da empresa + campos derivados (ex.: activation_rate). */
  companyContext(companyId: string): Promise<Record<string, unknown> | null>;
  /** Devolve 'duplicate' se já existir tarefa aberta com o mesmo dedupeKey. */
  createTask(task: NewTask): Promise<'created' | 'duplicate'>;
  recordRun(run: { ruleId: string; eventId: string; status: RunStatus; actions: ActionResult[] }): Promise<void>;
}
