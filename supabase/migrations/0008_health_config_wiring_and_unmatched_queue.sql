-- =========================================================================
-- PULSECS — 0008: LIGA A CALIBRAÇÃO AO RECÁLCULO + FILA "SEM CORRESPONDÊNCIA" SEGURA
-- Requer: 0007. Idempotente.
-- Corrige: (1) health_config não era lida por ninguém; (2) viewer/qualquer equipe editava
-- unmatched_metrics; (3) a fila não tinha limite, retenção, deduplicação nem como reaplicar.
-- =========================================================================

-- ---------- 1. health_config: uma única calibração ativa, histórico imutável ----------
-- Se houver mais de uma ativa, mantém só a mais recente.
UPDATE public.health_config SET is_active = FALSE
 WHERE is_active
   AND id <> (SELECT id FROM public.health_config WHERE is_active ORDER BY created_at DESC, id DESC LIMIT 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_health_config_one_active ON public.health_config ((TRUE)) WHERE is_active;

-- Antes de inserir uma calibração ativa: desativa a anterior e carimba o autor (não dá para forjar).
CREATE OR REPLACE FUNCTION public.fn_health_config_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN NEW.created_by := public.get_current_csm_id(); END IF;
  IF NEW.is_active THEN
    UPDATE public.health_config SET is_active = FALSE WHERE is_active;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_health_config_before_insert() FROM PUBLIC, anon, authenticated;

-- Depois: recalcula todas as empresas com os novos pesos.
CREATE OR REPLACE FUNCTION public.fn_health_config_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_active THEN PERFORM public.fn_recompute_health(); END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_health_config_after_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_health_config_before_insert ON public.health_config;
CREATE TRIGGER trg_health_config_before_insert BEFORE INSERT ON public.health_config
  FOR EACH ROW EXECUTE FUNCTION public.fn_health_config_before_insert();
DROP TRIGGER IF EXISTS trg_health_config_after_insert ON public.health_config;
CREATE TRIGGER trg_health_config_after_insert AFTER INSERT ON public.health_config
  FOR EACH ROW EXECUTE FUNCTION public.fn_health_config_after_insert();

-- Histórico: Head só INSERE (nada de UPDATE/DELETE). A troca da ativa é feita pelo gatilho.
DROP POLICY IF EXISTS health_config_write_head ON public.health_config;
DROP POLICY IF EXISTS health_config_insert_head ON public.health_config;
CREATE POLICY health_config_insert_head ON public.health_config
  FOR INSERT TO authenticated
  WITH CHECK (public.get_current_user_role() = 'head');
REVOKE UPDATE, DELETE ON public.health_config FROM authenticated, anon;

-- O recálculo agora usa a calibração ativa (sem ela, os padrões de fábrica).
CREATE OR REPLACE FUNCTION public.fn_recompute_health(p_company UUID DEFAULT NULL)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD; calc JSONB; n INT := 0;
  rh_days INT; renew_days INT;
  cfg RECORD;
  w_act NUMERIC := 0.35; w_mau NUMERIC := 0.25; w_rh NUMERIC := 0.15; w_ren NUMERIC := 0.15; w_nps NUMERIC := 0.10;
  pen INT := 25; t_green INT := 75; t_yellow INT := 50;
BEGIN
  PERFORM set_config('pulsecs.internal', '1', true);
  SELECT * INTO cfg FROM health_config WHERE is_active ORDER BY created_at DESC, id DESC LIMIT 1;
  IF FOUND THEN
    w_act := cfg.weight_activation; w_mau := cfg.weight_mau; w_rh := cfg.weight_rh;
    w_ren := cfg.weight_renewal; w_nps := cfg.weight_nps;
    pen := cfg.penalty_overdue; t_green := cfg.threshold_green; t_yellow := cfg.threshold_yellow;
  END IF;

  FOR r IN SELECT * FROM companies WHERE (p_company IS NULL OR id = p_company) LOOP
    IF r.eligible_lives = 0 THEN
      UPDATE companies SET risk_factors = '["Sem métricas de adoção (vidas elegíveis = 0): score ainda não calculado"]'::jsonb
       WHERE id = r.id AND risk_factors IS DISTINCT FROM '["Sem métricas de adoção (vidas elegíveis = 0): score ainda não calculado"]'::jsonb;
      CONTINUE;
    END IF;

    rh_days := CASE WHEN r.last_login_at IS NULL THEN NULL
                    ELSE GREATEST(0, (CURRENT_DATE - (r.last_login_at AT TIME ZONE 'UTC')::date)) END;
    renew_days := (r.renewal_date - CURRENT_DATE);
    calc := fn_health_calc_configurable(r.eligible_lives, r.active_lives, r.mau_lives, rh_days, renew_days,
                                        r.nps_score, r.has_overdue_invoice,
                                        w_act, w_mau, w_rh, w_ren, w_nps, pen, t_green, t_yellow);

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

-- ---------- 2. unmatched_metrics: ninguém da equipe edita direto ----------
ALTER TABLE public.unmatched_metrics ADD COLUMN IF NOT EXISTS hits INT NOT NULL DEFAULT 1;

DROP POLICY IF EXISTS unmatched_update_team ON public.unmatched_metrics;
REVOKE INSERT, UPDATE, DELETE ON public.unmatched_metrics FROM authenticated, anon;

-- Payload limitado (o servidor grava só os números já validados, nunca o corpo bruto).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unmatched_payload_small') THEN
    ALTER TABLE public.unmatched_metrics
      ADD CONSTRAINT unmatched_payload_small CHECK (octet_length(payload::text) <= 2048) NOT VALID;
  END IF;
END $$;

-- Uma pendência aberta por identificador: reenvios atualizam a mesma linha.
CREATE UNIQUE INDEX IF NOT EXISTS uq_unmatched_open
  ON public.unmatched_metrics (platform_name, (COALESCE(platform_id, '')), (COALESCE(cnpj, '')))
  WHERE NOT resolved;

-- Entrada (só o servidor): deduplica e limita a fila (5.000 pendências abertas).
CREATE OR REPLACE FUNCTION public.fn_enqueue_unmatched(p_platform_id TEXT, p_cnpj TEXT, p_payload JSONB, p_reason TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM unmatched_metrics
                  WHERE NOT resolved AND platform_name = 'benefits_platform'
                    AND COALESCE(platform_id, '') = COALESCE(p_platform_id, '') AND COALESCE(cnpj, '') = COALESCE(p_cnpj, ''))
     AND (SELECT count(*) FROM unmatched_metrics WHERE NOT resolved) >= 5000 THEN
    RETURN FALSE;
  END IF;
  INSERT INTO unmatched_metrics(platform_name, platform_id, cnpj, payload, reason)
  VALUES ('benefits_platform', left(p_platform_id, 128), left(p_cnpj, 14), COALESCE(p_payload, '{}'::jsonb), left(p_reason, 200))
  ON CONFLICT (platform_name, (COALESCE(platform_id, '')), (COALESCE(cnpj, ''))) WHERE NOT resolved
  DO UPDATE SET payload = EXCLUDED.payload, reason = EXCLUDED.reason, hits = unmatched_metrics.hits + 1, created_at = NOW();
  RETURN TRUE;
END $$;
REVOKE ALL ON FUNCTION public.fn_enqueue_unmatched(TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_enqueue_unmatched(TEXT, TEXT, JSONB, TEXT) TO service_role;

-- Resolver (só Head): vincula a empresa (cria o mapeamento estável quando veio platform_id),
-- reaplica as métricas guardadas e fecha a pendência. p_company NULL = descartar.
CREATE OR REPLACE FUNCTION public.fn_resolve_unmatched(p_id UUID, p_company UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u RECORD; me UUID := public.get_current_csm_id(); pl JSONB;
BEGIN
  IF public.get_current_user_role() IS DISTINCT FROM 'head' THEN
    RAISE EXCEPTION 'apenas o Head resolve pendências' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO u FROM unmatched_metrics WHERE id = p_id AND NOT resolved FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pendência não encontrada ou já resolvida'; END IF;

  IF p_company IS NULL THEN
    UPDATE unmatched_metrics SET resolved = TRUE, resolved_at = NOW(), resolved_by = me WHERE id = p_id;
    RETURN 'discarded';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company) THEN RAISE EXCEPTION 'empresa inexistente'; END IF;

  IF u.platform_id IS NOT NULL THEN
    INSERT INTO company_external_mappings(company_id, platform_name, external_platform_id, created_by)
    VALUES (p_company, u.platform_name, u.platform_id, me)
    ON CONFLICT (platform_name, external_platform_id) DO NOTHING;
    IF NOT EXISTS (SELECT 1 FROM company_external_mappings
                    WHERE platform_name = u.platform_name AND external_platform_id = u.platform_id AND company_id = p_company) THEN
      RAISE EXCEPTION 'esse ID da plataforma já está vinculado a outra empresa';
    END IF;
  END IF;

  pl := u.payload;
  UPDATE companies SET
    eligible_lives      = COALESCE((pl->>'eligible_lives')::int, eligible_lives),
    active_lives        = COALESCE((pl->>'active_lives')::int, active_lives),
    mau_lives           = COALESCE((pl->>'mau_lives')::int, mau_lives),
    total_savings       = COALESCE((pl->>'total_savings')::numeric, total_savings),
    nps_score           = CASE WHEN pl ? 'nps_score' THEN (pl->>'nps_score')::numeric ELSE nps_score END,
    has_overdue_invoice = COALESCE((pl->>'has_overdue_invoice')::boolean, has_overdue_invoice),
    last_login_at       = COALESCE((pl->>'last_login_at')::timestamptz, last_login_at)
  WHERE id = p_company;  -- o gatilho de 0005 recalcula o score

  UPDATE unmatched_metrics SET resolved = TRUE, resolved_to_company_id = p_company, resolved_at = NOW(), resolved_by = me WHERE id = p_id;
  RETURN 'applied';
END $$;
REVOKE ALL ON FUNCTION public.fn_resolve_unmatched(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_resolve_unmatched(UUID, UUID) TO authenticated, service_role;

-- Retenção (cron): resolvidas somem após p_days; pendentes abandonadas, após 3x.
CREATE OR REPLACE FUNCTION public.fn_purge_unmatched(p_days INT DEFAULT 90)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INT;
BEGIN
  DELETE FROM unmatched_metrics
   WHERE (resolved AND COALESCE(resolved_at, created_at) < NOW() - make_interval(days => p_days))
      OR (NOT resolved AND created_at < NOW() - make_interval(days => p_days * 3));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.fn_purge_unmatched(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_purge_unmatched(INT) TO service_role;

-- ---------- 4. Defesa em profundidade: anon nunca toca nas tabelas da Fase B (a RLS já nega, o GRANT também) ----------
REVOKE ALL ON public.health_config, public.company_external_mappings, public.unmatched_metrics FROM anon;
