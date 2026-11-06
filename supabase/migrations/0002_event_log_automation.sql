-- =========================================================================
-- PULSECS — EVENT LOG + MOTOR DE AUTOMAÇÃO (FASE 2)
-- Padrão adaptado do DeskcommCRM (MIT): triggers só gravam eventos,
-- workers por cron os consomem. Trigger NUNCA faz HTTP.
-- Requer: supabase/schema.sql aplicado antes.
-- =========================================================================

-- 1. event_log: fila de eventos (escrita só por trigger/service role)
CREATE TABLE IF NOT EXISTS public.event_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  entity_kind TEXT NOT NULL,
  entity_id UUID,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Idempotência: o mesmo fato (ex.: renovação em 30 dias) nunca entra duas vezes
  external_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'dead')),
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_event_log_claim ON public.event_log(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_event_log_company ON public.event_log(company_id, created_at DESC);

-- 2. automation_rules: QUANDO (trigger_event) SE (conditions, AND) ENTÃO (actions)
CREATE TABLE IF NOT EXISTS public.automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  trigger_event TEXT NOT NULL,
  conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  run_count INT NOT NULL DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_automation_rules_trigger ON public.automation_rules(trigger_event) WHERE is_active;

-- 3. automation_rule_runs: o que cada regra fez (a aba "Atividade")
CREATE TABLE IF NOT EXISTS public.automation_rule_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.event_log(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  actions_result JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Reprocessar o mesmo evento não duplica a execução da regra
  UNIQUE (rule_id, event_id)
);

-- 4. csm_tasks: alertas/tarefas geradas pelo motor para os CSMs
CREATE TABLE IF NOT EXISTS public.csm_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  csm_id UUID REFERENCES public.csm_users(id) ON DELETE SET NULL,
  rule_id UUID REFERENCES public.automation_rules(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT,
  severity TEXT NOT NULL DEFAULT 'warn' CHECK (severity IN ('info', 'warn', 'critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  dedupe_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  done_at TIMESTAMPTZ
);
-- No máximo uma tarefa ABERTA por (regra, empresa): evita inundar a fila do CSM
CREATE UNIQUE INDEX IF NOT EXISTS uq_csm_tasks_open_dedupe ON public.csm_tasks(dedupe_key) WHERE status = 'open' AND dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_csm_tasks_csm_open ON public.csm_tasks(csm_id) WHERE status = 'open';

-- =========================================================================
-- RLS
-- =========================================================================
ALTER TABLE public.event_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rule_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.csm_tasks ENABLE ROW LEVEL SECURITY;

-- event_log e runs: leitura só para o Head (diagnóstico). Escrita: apenas service role.
DROP POLICY IF EXISTS "event_log head select" ON public.event_log;
CREATE POLICY "event_log head select" ON public.event_log
  FOR SELECT TO authenticated USING (public.get_current_user_role() = 'head');
DROP POLICY IF EXISTS "rule_runs head select" ON public.automation_rule_runs;
CREATE POLICY "rule_runs head select" ON public.automation_rule_runs
  FOR SELECT TO authenticated USING (public.get_current_user_role() = 'head');

-- regras: todos leem; só o Head cria/edita
DROP POLICY IF EXISTS "rules select" ON public.automation_rules;
CREATE POLICY "rules select" ON public.automation_rules
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "rules head write" ON public.automation_rules;
CREATE POLICY "rules head write" ON public.automation_rules
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'head')
  WITH CHECK (public.get_current_user_role() = 'head');

-- tarefas: todos leem; Head edita tudo; CSM edita as suas; viewer não edita
DROP POLICY IF EXISTS "tasks select" ON public.csm_tasks;
CREATE POLICY "tasks select" ON public.csm_tasks
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "tasks update" ON public.csm_tasks;
CREATE POLICY "tasks update" ON public.csm_tasks
  FOR UPDATE TO authenticated
  USING (public.get_current_user_role() = 'head' OR csm_id = public.get_current_csm_id())
  WITH CHECK (public.get_current_user_role() = 'head' OR csm_id = public.get_current_csm_id());

-- =========================================================================
-- TRIGGERS: gravam eventos (nunca fazem HTTP)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.fn_companies_emit_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO event_log(event_type, entity_kind, entity_id, company_id, payload)
    VALUES ('company.created', 'company', NEW.id, NEW.id, jsonb_build_object('phase', NEW.phase));
    RETURN NEW;
  END IF;

  IF NEW.health_status IS DISTINCT FROM OLD.health_status THEN
    INSERT INTO event_log(event_type, entity_kind, entity_id, company_id, payload)
    VALUES ('company.health_changed', 'company', NEW.id, NEW.id,
      jsonb_build_object('from', OLD.health_status, 'to', NEW.health_status,
                         'score_from', OLD.health_score, 'score_to', NEW.health_score));
  END IF;

  IF NEW.phase IS DISTINCT FROM OLD.phase THEN
    INSERT INTO event_log(event_type, entity_kind, entity_id, company_id, payload)
    VALUES ('company.phase_changed', 'company', NEW.id, NEW.id,
      jsonb_build_object('from', OLD.phase, 'to', NEW.phase));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_companies_emit_events ON public.companies;
CREATE TRIGGER trg_companies_emit_events
  AFTER INSERT OR UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.fn_companies_emit_events();

-- =========================================================================
-- Eventos guiados pelo relógio (renovação próxima, RH sem login). Chamada pelo cron.
-- external_id garante que cada fato entra uma única vez.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.fn_emit_time_events()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n int := 0;
  r record;
  b int;
BEGIN
  FOR r IN
    SELECT id, renewal_date, (renewal_date - CURRENT_DATE) AS d
    FROM companies
    WHERE renewal_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 90
  LOOP
    b := CASE WHEN r.d <= 30 THEN 30 WHEN r.d <= 60 THEN 60 ELSE 90 END;
    INSERT INTO event_log(event_type, entity_kind, entity_id, company_id, payload, external_id)
    VALUES ('company.renewal_due', 'company', r.id, r.id,
            jsonb_build_object('bucket', b, 'days_to_renewal', r.d),
            'renewal:' || r.id || ':' || b || ':' || r.renewal_date)
    ON CONFLICT (external_id) DO NOTHING;
    IF FOUND THEN n := n + 1; END IF;
  END LOOP;

  FOR r IN
    SELECT id, GREATEST(0, EXTRACT(DAY FROM (NOW() - last_login_at))::int) AS days
    FROM companies
    WHERE last_login_at < NOW() - INTERVAL '14 days'
  LOOP
    INSERT INTO event_log(event_type, entity_kind, entity_id, company_id, payload, external_id)
    VALUES ('company.rh_inactive', 'company', r.id, r.id,
            jsonb_build_object('days_since_login', r.days),
            'rh_inactive:' || r.id || ':' || to_char(date_trunc('week', NOW()), 'IYYY-IW'))
    ON CONFLICT (external_id) DO NOTHING;
    IF FOUND THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END $$;

-- =========================================================================
-- Claim atômico para o worker (FOR UPDATE SKIP LOCKED): dois workers nunca
-- pegam o mesmo evento; eventos "processing" órfãos voltam à fila.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.fn_claim_events(p_limit int DEFAULT 20, p_stale_seconds int DEFAULT 600)
RETURNS SETOF public.event_log LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH c AS (
    SELECT id FROM event_log
    WHERE (status = 'pending' AND next_attempt_at <= NOW())
       OR (status = 'processing' AND locked_at < NOW() - make_interval(secs => p_stale_seconds))
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE event_log e
     SET status = 'processing', locked_at = NOW(), attempts = e.attempts + 1
    FROM c
   WHERE e.id = c.id
  RETURNING e.*;
END $$;

-- Funções de worker: somente service role (nunca expostas ao navegador)
REVOKE ALL ON FUNCTION public.fn_emit_time_events() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_claim_events(int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_companies_emit_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_emit_time_events() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_claim_events(int, int) TO service_role;

-- =========================================================================
-- Regras padrão (idempotentes pelo nome)
-- Templates aceitam {{company.name}}, {{event.days_to_renewal}} etc.
-- =========================================================================
INSERT INTO public.automation_rules (name, trigger_event, conditions, actions) VALUES
(
  'Cliente entrou em risco',
  'company.health_changed',
  '[{"field":"event.to","op":"eq","value":"red"}]',
  '[{"type":"create_task","config":{"severity":"critical","title":"{{company.name}} entrou em risco (score {{event.score_to}})","body":"Motivo registrado: {{company.risk_reason}}. Agendar alinhamento de risco."}}]'
),
(
  'Renovação próxima com score baixo',
  'company.renewal_due',
  '[{"field":"company.health_score","op":"lt","value":"75"}]',
  '[{"type":"create_task","config":{"severity":"warn","title":"Renovação de {{company.name}} em {{event.days_to_renewal}} dias com score {{company.health_score}}","body":"Ativação: {{company.activation_rate}}%. Preparar QBR com economia gerada."}}]'
),
(
  'RH sem login há 14 dias',
  'company.rh_inactive',
  '[]',
  '[{"type":"create_task","config":{"severity":"warn","title":"RH de {{company.name}} sem login há {{event.days_since_login}} dias","body":"Contatar o gestor de RH para retomar a promoção do benefício."}}]'
),
(
  'Ativação baixa na virada de fase',
  'company.phase_changed',
  '[{"field":"event.to","op":"eq","value":"Go-Live"},{"field":"company.activation_rate","op":"lt","value":"50"}]',
  '[{"type":"create_task","config":{"severity":"warn","title":"{{company.name}} foi para Go-Live com ativação de {{company.activation_rate}}%","body":"Meta saudável: 75%. Planejar campanha de ativação com o RH."}}]'
)
ON CONFLICT (name) DO NOTHING;
