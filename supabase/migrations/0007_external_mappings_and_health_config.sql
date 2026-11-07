-- =========================================================================
-- PULSECS — MAPEAMENTO EXTERNO, FILA DE NÃO-CORRESPONDÊNCIA E CALIBRAÇÃO DE HEALTH SCORE (FASE B)
-- Requer: schema.sql, 0002, 0003, 0004, 0005, 0006. Idempotente.
-- =========================================================================

-- 1. TABELA: company_external_mappings
-- Mapeamento estável entre ID na plataforma de benefícios e empresa do PulseCS
CREATE TABLE IF NOT EXISTS public.company_external_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  platform_name TEXT NOT NULL DEFAULT 'benefits_platform',
  external_platform_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.csm_users(id) ON DELETE SET NULL,
  CONSTRAINT uq_platform_external_id UNIQUE (platform_name, external_platform_id)
);

CREATE INDEX IF NOT EXISTS idx_ext_mappings_company ON public.company_external_mappings(company_id);
CREATE INDEX IF NOT EXISTS idx_ext_mappings_platform ON public.company_external_mappings(platform_name, external_platform_id);

-- 2. TABELA: unmatched_metrics
-- Fila de telemetria recebida sem correspondência direta para revisão manual da equipe de CS
CREATE TABLE IF NOT EXISTS public.unmatched_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_name TEXT NOT NULL DEFAULT 'benefits_platform',
  platform_id TEXT,
  cnpj TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_to_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.csm_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_unmatched_resolved ON public.unmatched_metrics(resolved);
CREATE INDEX IF NOT EXISTS idx_unmatched_created_at ON public.unmatched_metrics(created_at DESC);

-- 3. TABELA: health_config
-- Configuração de pesos e calibração do Health Score com histórico de auditoria (somente Head altera)
CREATE TABLE IF NOT EXISTS public.health_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  weight_activation NUMERIC(4,3) NOT NULL DEFAULT 0.35 CHECK (weight_activation >= 0),
  weight_mau NUMERIC(4,3) NOT NULL DEFAULT 0.25 CHECK (weight_mau >= 0),
  weight_rh NUMERIC(4,3) NOT NULL DEFAULT 0.15 CHECK (weight_rh >= 0),
  weight_renewal NUMERIC(4,3) NOT NULL DEFAULT 0.15 CHECK (weight_renewal >= 0),
  weight_nps NUMERIC(4,3) NOT NULL DEFAULT 0.10 CHECK (weight_nps >= 0),
  penalty_overdue INT NOT NULL DEFAULT 25 CHECK (penalty_overdue >= 0),
  threshold_green INT NOT NULL DEFAULT 75 CHECK (threshold_green BETWEEN 1 AND 100),
  threshold_yellow INT NOT NULL DEFAULT 50 CHECK (threshold_yellow BETWEEN 0 AND threshold_green),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.csm_users(id) ON DELETE SET NULL,
  CONSTRAINT health_config_weights_sum CHECK (
    abs((weight_activation + weight_mau + weight_rh + weight_renewal + weight_nps) - 1.0) < 0.005
  )
);

CREATE INDEX IF NOT EXISTS idx_health_config_active ON public.health_config(is_active, created_at DESC);

-- Inserir configuração padrão inicial caso ainda não exista nenhuma
INSERT INTO public.health_config (
  weight_activation, weight_mau, weight_rh, weight_renewal, weight_nps,
  penalty_overdue, threshold_green, threshold_yellow, is_active, notes
)
SELECT 0.35, 0.25, 0.15, 0.15, 0.10, 25, 75, 50, TRUE, 'Configuração padrão de fábrica (ADR-0015)'
WHERE NOT EXISTS (SELECT 1 FROM public.health_config WHERE is_active = TRUE);

-- 4. ATUALIZAR FUNÇÃO DE CÁLCULO PARA SUPORTAR CONFIGURAÇÃO CALIBRÁVEL
-- Permite passar pesos customizados ou usar a configuração ativa da tabela health_config
CREATE OR REPLACE FUNCTION public.fn_health_calc_configurable(
  p_eligible INT, p_active INT, p_mau INT, p_rh_days INT, p_days_to_renewal INT,
  p_nps NUMERIC DEFAULT 8, p_overdue BOOLEAN DEFAULT FALSE,
  p_w_act NUMERIC DEFAULT 0.35, p_w_mau NUMERIC DEFAULT 0.25,
  p_w_rh NUMERIC DEFAULT 0.15, p_w_renov NUMERIC DEFAULT 0.15,
  p_w_nps NUMERIC DEFAULT 0.10, p_penalty_overdue INT DEFAULT 25,
  p_thresh_green INT DEFAULT 75, p_thresh_yellow INT DEFAULT 50
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

  total := round(
    p_w_act * s_ativ +
    p_w_mau * s_mau +
    p_w_rh * s_rh +
    p_w_renov * s_renov +
    p_w_nps * s_nps
  )::int;

  IF COALESCE(p_overdue, FALSE) THEN
    total := GREATEST(0, total - p_penalty_overdue);
    f := f || to_jsonb('Fatura em atraso / Inadimplência financeira'::text);
  END IF;

  status := CASE
    WHEN total >= p_thresh_green THEN 'green'
    WHEN total >= p_thresh_yellow THEN 'yellow'
    ELSE 'red'
  END;

  RETURN jsonb_build_object(
    'score', total, 'status', status,
    'activation_rate', round(act, 2), 'mau_rate', round(mau, 2),
    'rh_score', s_rh, 'risk_factors', f
  );
END;
$$;

-- Mantém a função fn_health_calc original compatível invocando a configurável com os defaults
CREATE OR REPLACE FUNCTION public.fn_health_calc(
  p_eligible INT, p_active INT, p_mau INT, p_rh_days INT, p_days_to_renewal INT,
  p_nps NUMERIC DEFAULT 8, p_overdue BOOLEAN DEFAULT FALSE
) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT public.fn_health_calc_configurable(
    p_eligible, p_active, p_mau, p_rh_days, p_days_to_renewal, p_nps, p_overdue
  );
$$;

-- 5. POLÍTICAS RLS (Row-Level Security)
ALTER TABLE public.company_external_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unmatched_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_config ENABLE ROW LEVEL SECURITY;

-- company_external_mappings
DROP POLICY IF EXISTS ext_mappings_select ON public.company_external_mappings;
CREATE POLICY ext_mappings_select ON public.company_external_mappings
  FOR SELECT TO authenticated
  USING (public.fn_is_staff());

DROP POLICY IF EXISTS ext_mappings_write_head ON public.company_external_mappings;
CREATE POLICY ext_mappings_write_head ON public.company_external_mappings
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'head')
  WITH CHECK (public.get_current_user_role() = 'head');

-- unmatched_metrics
DROP POLICY IF EXISTS unmatched_select ON public.unmatched_metrics;
CREATE POLICY unmatched_select ON public.unmatched_metrics
  FOR SELECT TO authenticated
  USING (public.fn_is_staff());

DROP POLICY IF EXISTS unmatched_update_team ON public.unmatched_metrics;
CREATE POLICY unmatched_update_team ON public.unmatched_metrics
  FOR UPDATE TO authenticated
  USING (public.fn_is_staff())
  WITH CHECK (public.fn_is_staff());

-- health_config
DROP POLICY IF EXISTS health_config_select ON public.health_config;
CREATE POLICY health_config_select ON public.health_config
  FOR SELECT TO authenticated
  USING (public.fn_is_staff());

DROP POLICY IF EXISTS health_config_write_head ON public.health_config;
CREATE POLICY health_config_write_head ON public.health_config
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'head')
  WITH CHECK (public.get_current_user_role() = 'head');
