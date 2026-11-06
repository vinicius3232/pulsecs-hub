-- =========================================================================
-- PULSECS — PASSOS DE ESPERA (delay), EXECUÇÃO MANUAL E VIEWS SALVAS
-- Requer: schema.sql e 0002_event_log_automation.sql aplicados antes.
-- Idempotente.
-- =========================================================================

-- 1. A execução de uma regra pode ficar "waiting" (pausada por um delay)
ALTER TABLE public.automation_rule_runs DROP CONSTRAINT IF EXISTS automation_rule_runs_status_check;
ALTER TABLE public.automation_rule_runs
  ADD CONSTRAINT automation_rule_runs_status_check CHECK (status IN ('success', 'partial', 'failed', 'waiting'));

-- 2. Passos agendados: o cron retoma a regra a partir de next_index
CREATE TABLE IF NOT EXISTS public.automation_scheduled_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.event_log(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  next_index INT NOT NULL CHECK (next_index >= 1),
  resume_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed', 'cancelled')),
  attempts INT NOT NULL DEFAULT 0,
  locked_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Reprocessar o mesmo evento não duplica a espera do mesmo passo
  UNIQUE (rule_id, event_id, next_index)
);
CREATE INDEX IF NOT EXISTS idx_sched_steps_due ON public.automation_scheduled_steps(status, resume_at);

ALTER TABLE public.automation_scheduled_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sched_steps head select" ON public.automation_scheduled_steps;
CREATE POLICY "sched_steps head select" ON public.automation_scheduled_steps
  FOR SELECT TO authenticated USING (public.get_current_user_role() = 'head');

-- Claim atômico (SKIP LOCKED) dos passos vencidos; "processing" órfão volta à fila
CREATE OR REPLACE FUNCTION public.fn_claim_scheduled_steps(p_limit int DEFAULT 20, p_stale_seconds int DEFAULT 600)
RETURNS SETOF public.automation_scheduled_steps LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH c AS (
    SELECT id FROM automation_scheduled_steps
    WHERE (status = 'pending' AND resume_at <= NOW())
       OR (status = 'processing' AND locked_at < NOW() - make_interval(secs => p_stale_seconds))
    ORDER BY resume_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE automation_scheduled_steps s
     SET status = 'processing', locked_at = NOW(), attempts = s.attempts + 1
    FROM c
   WHERE s.id = c.id
  RETURNING s.*;
END $$;

REVOKE ALL ON FUNCTION public.fn_claim_scheduled_steps(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_claim_scheduled_steps(int, int) TO service_role;

-- 3. Views salvas da carteira (filtros + ordenação). Pessoais ou compartilhadas.
CREATE TABLE IF NOT EXISTS public.saved_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.csm_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  scope TEXT NOT NULL DEFAULT 'companies' CHECK (scope IN ('companies')),
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort TEXT NOT NULL DEFAULT 'hs_asc',
  is_shared BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, scope, name)
);
CREATE INDEX IF NOT EXISTS idx_saved_views_owner ON public.saved_views(owner_id);

ALTER TABLE public.saved_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "views select" ON public.saved_views;
CREATE POLICY "views select" ON public.saved_views
  FOR SELECT TO authenticated
  USING (owner_id = public.get_current_csm_id() OR is_shared OR public.get_current_user_role() = 'head');
DROP POLICY IF EXISTS "views write own" ON public.saved_views;
CREATE POLICY "views write own" ON public.saved_views
  FOR ALL TO authenticated
  USING (owner_id = public.get_current_csm_id() OR public.get_current_user_role() = 'head')
  WITH CHECK (owner_id = public.get_current_csm_id() OR public.get_current_user_role() = 'head');

-- 4. Regras de exemplo: execução manual e cadência com espera + if/else
INSERT INTO public.automation_rules (name, trigger_event, conditions, actions) VALUES
(
  'Onboarding parado: checar após 7 dias',
  'company.phase_changed',
  '[{"field":"event.to","op":"eq","value":"Config & Carga"}]',
  '[
    {"type":"delay","config":{"days":7}},
    {"type":"if","config":{
      "conditions":[{"field":"company.phase","op":"eq","value":"Config & Carga"}],
      "then":[
        {"type":"create_task","config":{"severity":"warn","title":"{{company.name}} segue em Config & Carga há 7 dias","body":"Destravar a carga de dados com o RH."}},
        {"type":"add_note","config":{"content":"Automação: onboarding sem avanço após 7 dias."}}
      ],
      "else":[]
    }}
  ]'
),
(
  'Preparar QBR (execução manual)',
  'manual.run',
  '[]',
  '[
    {"type":"add_note","config":{"content":"QBR preparado manualmente. Ativação: {{company.activation_rate}}%, score {{company.health_score}}."}},
    {"type":"create_task","config":{"severity":"info","title":"Levantar dados do QBR de {{company.name}}","body":"Economia gerada, ativação e MAU do trimestre."}}
  ]'
)
ON CONFLICT (name) DO NOTHING;
