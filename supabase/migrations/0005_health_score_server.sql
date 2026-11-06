-- =========================================================================
-- PULSECS — HEALTH SCORE CALCULADO NO SERVIDOR (P2)
-- Porta a fórmula de src/lib/health-score.ts para o banco (paridade testada em supabase/tests/health.test.mjs).
-- O score deixa de ser digitado: nasce das métricas de adoção, do login do RH, da renovação, do NPS e da inadimplência.
-- Requer: schema.sql, 0002, 0003 e 0004. Idempotente.
-- =========================================================================

-- 1. Colunas novas
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS nps_score NUMERIC(3,1) CHECK (nps_score BETWEEN 0 AND 10);
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS has_overdue_invoice BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS risk_factors JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS health_computed_at TIMESTAMPTZ;

-- Dados de adoção consistentes: ativadas <= elegíveis, MAU <= ativadas, nada negativo
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_lives_consistent;
ALTER TABLE public.companies ADD CONSTRAINT companies_lives_consistent
  CHECK (eligible_lives >= 0 AND active_lives >= 0 AND mau_lives >= 0
         AND active_lives <= eligible_lives AND mau_lives <= active_lives);

-- Um snapshot por empresa por dia (o cron pode rodar de novo sem duplicar)
CREATE UNIQUE INDEX IF NOT EXISTS uq_health_snapshots_day ON public.health_snapshots(company_id, recorded_at);

-- 2. Fórmula (idêntica a calculateAdoptionHealthScore). Pura e imutável.
--    p_rh_days NULL = o RH nunca logou (tratado como 40 pontos, sem rotular "abandono").
CREATE OR REPLACE FUNCTION public.fn_health_calc(
  p_eligible INT, p_active INT, p_mau INT, p_rh_days INT, p_days_to_renewal INT,
  p_nps NUMERIC DEFAULT 8, p_overdue BOOLEAN DEFAULT FALSE
) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  act NUMERIC; mau NUMERIC;
  s_ativ INT; s_mau INT; s_rh INT; s_renov INT; s_nps INT;
  total INT; status TEXT;
  f JSONB := '[]'::jsonb;
  nps NUMERIC := COALESCE(p_nps, 8);
BEGIN
  act := CASE WHEN p_eligible > 0 THEN (p_active::numeric / p_eligible) * 100 ELSE 0 END;
  IF act >= 80 THEN s_ativ := 100;
  ELSIF act >= 50 THEN s_ativ := 60;
  ELSE s_ativ := 25; f := f || to_jsonb('Ativação de colaboradores crítica (' || round(act, 1) || '% < 50%)');
  END IF;

  mau := CASE WHEN p_active > 0 THEN (p_mau::numeric / p_active) * 100 ELSE 0 END;
  IF mau >= 75 THEN s_mau := 100;
  ELSIF mau >= 45 THEN s_mau := 60;
  ELSE s_mau := 20; f := f || to_jsonb('Uso mensal estagnado (' || round(mau, 1) || '% dos ativados usam)');
  END IF;

  IF p_rh_days IS NULL THEN
    s_rh := 40; f := f || to_jsonb('Gestor de RH ainda sem login registrado'::text);
  ELSIF p_rh_days <= 7 THEN s_rh := 100;
  ELSIF p_rh_days <= 14 THEN s_rh := 70;
  ELSIF p_rh_days <= 30 THEN s_rh := 40; f := f || to_jsonb('Gestor de RH ausente há ' || p_rh_days || ' dias');
  ELSE s_rh := 10; f := f || to_jsonb('Abandono operacional do RH (' || p_rh_days || ' dias sem login)');
  END IF;

  s_renov := 100;
  IF p_days_to_renewal <= 60 THEN
    IF act < 60 OR mau < 50 THEN
      s_renov := 20; f := f || to_jsonb('Vencimento próximo (' || p_days_to_renewal || ' dias) com baixa adoção');
    ELSE s_renov := 80;
    END IF;
  END IF;

  IF nps >= 9 THEN s_nps := 100;
  ELSIF nps >= 7 THEN s_nps := 60;
  ELSE s_nps := 10; f := f || to_jsonb('Cliente detrator no último NPS (' || nps || '/10)');
  END IF;

  total := round(0.35 * s_ativ + 0.25 * s_mau + 0.15 * s_rh + 0.15 * s_renov + 0.10 * s_nps)::int;

  IF COALESCE(p_overdue, FALSE) THEN
    total := GREATEST(0, total - 25);
    f := f || to_jsonb('Fatura em atraso / Inadimplência financeira'::text);
  END IF;

  status := CASE WHEN total >= 75 THEN 'green' WHEN total >= 50 THEN 'yellow' ELSE 'red' END;

  RETURN jsonb_build_object('score', total, 'status', status,
                            'activation_rate', round(act, 2), 'mau_rate', round(mau, 2),
                            'rh_score', s_rh, 'risk_factors', f);
END $$;

-- 3. Recalcula uma empresa (ou todas) e grava o snapshot do dia.
--    Empresas SEM métricas (eligible_lives = 0) não são pontuadas: nenhum falso alarme.
CREATE OR REPLACE FUNCTION public.fn_recompute_health(p_company UUID DEFAULT NULL)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD; calc JSONB; n INT := 0;
  rh_days INT; renew_days INT;
BEGIN
  -- Marca "operação interna" (só nesta transação) para o guard de colunas não barrar o recálculo
  PERFORM set_config('pulsecs.internal', '1', true);
  FOR r IN SELECT * FROM companies WHERE (p_company IS NULL OR id = p_company) LOOP
    IF r.eligible_lives = 0 THEN
      UPDATE companies SET risk_factors = '["Sem métricas de adoção (vidas elegíveis = 0): score ainda não calculado"]'::jsonb
       WHERE id = r.id AND risk_factors IS DISTINCT FROM '["Sem métricas de adoção (vidas elegíveis = 0): score ainda não calculado"]'::jsonb;
      CONTINUE;
    END IF;

    rh_days := CASE WHEN r.last_login_at IS NULL THEN NULL
                    ELSE GREATEST(0, (CURRENT_DATE - (r.last_login_at AT TIME ZONE 'UTC')::date)) END;
    renew_days := (r.renewal_date - CURRENT_DATE);
    calc := fn_health_calc(r.eligible_lives, r.active_lives, r.mau_lives, rh_days, renew_days, r.nps_score, r.has_overdue_invoice);

    UPDATE companies
       SET health_score = (calc->>'score')::int,
           health_status = calc->>'status',
           risk_factors = calc->'risk_factors',
           health_computed_at = NOW()
     WHERE id = r.id;

    INSERT INTO health_snapshots(company_id, health_score, activation_rate, mau_rate, total_savings, rh_engagement_score, recorded_at)
    VALUES (r.id, (calc->>'score')::int, (calc->>'activation_rate')::numeric, (calc->>'mau_rate')::numeric,
            r.total_savings, (calc->>'rh_score')::int, CURRENT_DATE)
    ON CONFLICT (company_id, recorded_at) DO UPDATE
      SET health_score = EXCLUDED.health_score, activation_rate = EXCLUDED.activation_rate, mau_rate = EXCLUDED.mau_rate,
          total_savings = EXCLUDED.total_savings, rh_engagement_score = EXCLUDED.rh_engagement_score;
    n := n + 1;
  END LOOP;
  PERFORM set_config('pulsecs.internal', '', true);
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.fn_recompute_health(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_recompute_health(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_health_calc(INT, INT, INT, INT, INT, NUMERIC, BOOLEAN) TO authenticated, service_role;

-- 4. Recalcula sozinho quando uma entrada do score muda (o UPDATE interno mexe só em colunas de
--    saída, que não estão na lista do gatilho: não há recursão).
CREATE OR REPLACE FUNCTION public.fn_companies_recompute_on_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.fn_recompute_health(NEW.id);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_companies_recompute_on_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_companies_recompute_on_change ON public.companies;
CREATE TRIGGER trg_companies_recompute_on_change
  AFTER INSERT OR UPDATE OF eligible_lives, active_lives, mau_lives, last_login_at, renewal_date, nps_score, has_overdue_invoice
  ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.fn_companies_recompute_on_change();

-- 5. Quem pode alterar entradas e saídas do score
--    csm/is: nunca (métricas vêm da plataforma de benefícios via ingestão; o score é do servidor).
--    head: pode corrigir métricas na mão (o score é recalculado em seguida).
--    "is" continua sem mexer em gestor, valores e contrato (0004).
CREATE OR REPLACE FUNCTION public.fn_companies_guard_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  role_now TEXT := public.get_current_user_role();
BEGIN
  IF current_setting('pulsecs.internal', true) = '1' THEN RETURN NEW; END IF; -- recálculo do servidor
  IF role_now IN ('csm', 'is') THEN
    IF NEW.eligible_lives IS DISTINCT FROM OLD.eligible_lives
       OR NEW.active_lives IS DISTINCT FROM OLD.active_lives
       OR NEW.mau_lives IS DISTINCT FROM OLD.mau_lives
       OR NEW.total_savings IS DISTINCT FROM OLD.total_savings
       OR NEW.nps_score IS DISTINCT FROM OLD.nps_score
       OR NEW.has_overdue_invoice IS DISTINCT FROM OLD.has_overdue_invoice
       OR NEW.last_login_at IS DISTINCT FROM OLD.last_login_at
       OR NEW.renewal_date IS DISTINCT FROM OLD.renewal_date
       OR NEW.health_score IS DISTINCT FROM OLD.health_score
       OR NEW.health_status IS DISTINCT FROM OLD.health_status
       OR NEW.risk_factors IS DISTINCT FROM OLD.risk_factors
       OR NEW.health_computed_at IS DISTINCT FROM OLD.health_computed_at THEN
      RAISE EXCEPTION 'métricas, renovação e health score são calculados pelo servidor' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF role_now = 'is' THEN
    IF NEW.csm_id IS DISTINCT FROM OLD.csm_id
       OR NEW.mrr IS DISTINCT FROM OLD.mrr
       OR NEW.pepm IS DISTINCT FROM OLD.pepm
       OR NEW.tier IS DISTINCT FROM OLD.tier
       OR NEW.contract_start_date IS DISTINCT FROM OLD.contract_start_date THEN
      RAISE EXCEPTION 'perfil "is" não pode alterar gestor, valores ou contrato' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_companies_guard_columns() FROM PUBLIC, anon, authenticated;

-- Quem insere (csm) também não semeia métricas/score: força os padrões
CREATE OR REPLACE FUNCTION public.fn_companies_guard_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_current_user_role() = 'csm' THEN
    NEW.eligible_lives := 0; NEW.active_lives := 0; NEW.mau_lives := 0; NEW.total_savings := 0;
    NEW.nps_score := NULL; NEW.has_overdue_invoice := FALSE; NEW.health_computed_at := NULL;
    NEW.health_score := 85; NEW.health_status := 'green'; NEW.risk_factors := '[]'::jsonb;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_companies_guard_insert() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_companies_guard_insert ON public.companies;
CREATE TRIGGER trg_companies_guard_insert BEFORE INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.fn_companies_guard_insert();
