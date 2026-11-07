import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ActionResult, AutomationStore, NewNote, NewScheduledStep, NewTask, RuleRow, RunStatus, ScheduledStep
} from './types.js';

const PG_UNIQUE_VIOLATION = '23505';

/**
 * Implementação do AutomationStore sobre o Supabase com service role.
 * O service role ignora o RLS: aqui só se lê/grava por ids vindos do próprio evento.
 */
export function createSupabaseStore(admin: SupabaseClient): AutomationStore {
  return {
    async activeRulesFor(eventType) {
      const { data, error } = await admin
        .from('automation_rules')
        .select('id, name, conditions, actions, is_active')
        .eq('trigger_event', eventType)
        .eq('is_active', true)
        .order('created_at', { ascending: true });
      if (error) throw new Error(`rules: ${error.message}`);
      return (data ?? []) as RuleRow[];
    },

    async ruleById(id) {
      const { data, error } = await admin
        .from('automation_rules')
        .select('id, name, conditions, actions, is_active')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(`rule: ${error.message}`);
      return (data as RuleRow | null) ?? null;
    },

    async companyContext(companyId) {
      const { data, error } = await admin.from('companies').select('*').eq('id', companyId).maybeSingle();
      if (error) throw new Error(`company: ${error.message}`);
      if (!data) return null;
      const eligible = Number(data.eligible_lives) || 0;
      const pct = (n: unknown) => (eligible > 0 ? Math.round(((Number(n) || 0) / eligible) * 1000) / 10 : undefined);
      // Sem vidas elegíveis a taxa é desconhecida (undefined): condições numéricas falham fechadas.
      return { ...data, activation_rate: pct(data.active_lives), mau_rate: pct(data.mau_lives) };
    },

    async createTask(task: NewTask) {
      const { error } = await admin.from('csm_tasks').insert({
        company_id: task.companyId,
        csm_id: task.csmId,
        rule_id: task.ruleId,
        title: task.title,
        body: task.body,
        severity: task.severity,
        dedupe_key: task.dedupeKey
      });
      if (!error) return 'created';
      if (error.code === PG_UNIQUE_VIOLATION) return 'duplicate';
      throw new Error(`task: ${error.message}`);
    },

    async addNote(note: NewNote) {
      const { error } = await admin.from('interactions').insert({
        company_id: note.companyId,
        csm_id: note.csmId,
        channel: 'note',
        trigger_type: 'automation',
        content: note.content,
        status: 'sent'
      });
      if (error) throw new Error(`note: ${error.message}`);
    },

    async claimStepIdempotency(claim) {
      const idempotencyKey = `${claim.ruleId}:${claim.eventId}:${claim.stepKey}`;
      const { error } = await admin.from('automation_step_idempotency').insert({
        rule_id: claim.ruleId,
        event_id: claim.eventId,
        step_key: claim.stepKey,
        idempotency_key: idempotencyKey,
        action_type: claim.actionType,
        status: 'started'
      });
      if (!error) return 'claimed';
      if (error.code === PG_UNIQUE_VIOLATION) return 'duplicate';
      throw new Error(`step_idempotency: ${error.message}`);
    },

    async completeStepIdempotency(ruleId, eventId, stepKey) {
      const idempotencyKey = `${ruleId}:${eventId}:${stepKey}`;
      const { error } = await admin
        .from('automation_step_idempotency')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('idempotency_key', idempotencyKey);
      if (error) throw new Error(`complete_step_idempotency: ${error.message}`);
    },

    async recordRun(run: { ruleId: string; eventId: string; status: RunStatus; actions: ActionResult[] }) {
      // Upsert por (regra, evento): a retomada de uma espera atualiza o mesmo registro.
      const { error } = await admin
        .from('automation_rule_runs')
        .upsert(
          { rule_id: run.ruleId, event_id: run.eventId, status: run.status, actions_result: run.actions },
          { onConflict: 'rule_id,event_id' }
        );
      if (error) throw new Error(`run: ${error.message}`);

      // Contador informativo (não é invariante): leitura + escrita é aceitável.
      const { data } = await admin.from('automation_rules').select('run_count').eq('id', run.ruleId).maybeSingle();
      await admin
        .from('automation_rules')
        .update({ last_run_at: new Date().toISOString(), run_count: (data?.run_count ?? 0) + 1 })
        .eq('id', run.ruleId);
    },

    async getRunActions(ruleId, eventId) {
      const { data } = await admin
        .from('automation_rule_runs')
        .select('actions_result')
        .eq('rule_id', ruleId)
        .eq('event_id', eventId)
        .maybeSingle();
      return ((data?.actions_result as ActionResult[] | undefined) ?? []).map(a => ({ ...a }));
    },

    async scheduleResume(step: NewScheduledStep) {
      const { error } = await admin.from('automation_scheduled_steps').insert({
        rule_id: step.ruleId,
        event_id: step.eventId,
        company_id: step.companyId,
        event_type: step.eventType,
        payload: step.payload,
        next_index: step.nextIndex,
        resume_at: step.resumeAt
      });
      if (!error) return 'scheduled';
      if (error.code === PG_UNIQUE_VIOLATION) return 'duplicate';
      throw new Error(`schedule: ${error.message}`);
    },

    async claimDueScheduled(limit) {
      const { data, error } = await admin.rpc('fn_claim_scheduled_steps', { p_limit: limit });
      if (error) throw new Error(`claim_scheduled: ${error.message}`);
      return (data ?? []) as ScheduledStep[];
    },

    async finishScheduled(id, status, errorMsg) {
      await admin
        .from('automation_scheduled_steps')
        .update({ status, last_error: errorMsg ? errorMsg.slice(0, 300) : null, locked_at: null })
        .eq('id', id);
    },

    async retryScheduled(id, resumeAt, errorMsg) {
      await admin
        .from('automation_scheduled_steps')
        .update({ status: 'pending', resume_at: resumeAt, last_error: errorMsg.slice(0, 300), locked_at: null })
        .eq('id', id);
    }
  };
}
