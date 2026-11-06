import type { SupabaseClient } from '@supabase/supabase-js';
import type { AutomationStore, NewTask, RuleRow, RunStatus, ActionResult } from './types';

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
        .select('id, name, conditions, actions')
        .eq('trigger_event', eventType)
        .eq('is_active', true)
        .order('created_at', { ascending: true });
      if (error) throw new Error(`rules: ${error.message}`);
      return (data ?? []) as RuleRow[];
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

    async recordRun(run: { ruleId: string; eventId: string; status: RunStatus; actions: ActionResult[] }) {
      const { error } = await admin.from('automation_rule_runs').insert({
        rule_id: run.ruleId,
        event_id: run.eventId,
        status: run.status,
        actions_result: run.actions
      });
      // Reprocesso do mesmo evento: a execução já está registrada.
      if (error && error.code !== PG_UNIQUE_VIOLATION) throw new Error(`run: ${error.message}`);

      if (!error) {
        // Contador informativo (não é invariante): leitura + escrita é aceitável.
        const { data } = await admin.from('automation_rules').select('run_count').eq('id', run.ruleId).maybeSingle();
        await admin
          .from('automation_rules')
          .update({ last_run_at: new Date().toISOString(), run_count: (data?.run_count ?? 0) + 1 })
          .eq('id', run.ruleId);
      }
    }
  };
}
