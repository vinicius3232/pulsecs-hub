-- =========================================================================
-- PULSECS — SAÚDE DO SISTEMA (D4)
-- Métricas agregadas da fila de eventos, falhas recentes e atrasos.
-- Exclusivo para o Head: SECURITY DEFINER checa o papel e não expõe
-- a tabela event_log diretamente para o cliente.
-- Idempotente.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.fn_system_health()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT;
  v_pending_count INT;
  v_dead_count INT;
  v_oldest_seconds INT;
  v_last_cron TIMESTAMPTZ;
  v_failed_runs JSONB;
  v_result JSONB;
BEGIN
  -- 1. Autorização estrita: somente o Head pode ver os indicadores de saúde do sistema
  v_role := public.get_current_user_role();
  IF v_role IS DISTINCT FROM 'head' THEN
    RAISE EXCEPTION 'Forbidden: apenas o Head pode consultar a saúde do sistema';
  END IF;

  -- 2. Contagem de eventos pendentes e em processamento
  SELECT COUNT(*)::INT INTO v_pending_count
  FROM public.event_log
  WHERE status IN ('pending', 'processing');

  -- 3. Contagem de eventos mortos (dead) que esgotaram tentativas
  SELECT COUNT(*)::INT INTO v_dead_count
  FROM public.event_log
  WHERE status = 'dead';

  -- 4. Atraso do evento pendente mais antigo (em segundos)
  SELECT COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))::INT, 0) INTO v_oldest_seconds
  FROM public.event_log
  WHERE status IN ('pending', 'processing');

  -- 5. Última execução registrada de automação / drenagem
  SELECT GREATEST(
    (SELECT MAX(created_at) FROM public.automation_rule_runs),
    (SELECT MAX(created_at) FROM public.event_log WHERE status = 'done')
  ) INTO v_last_cron;

  -- 6. Últimas falhas de execução (máx 5, apenas metadados seguros)
  SELECT COALESCE(jsonb_agg(f), '[]'::jsonb) INTO v_failed_runs
  FROM (
    SELECT 
      r.id,
      r.rule_id,
      COALESCE(ar.name, 'Regra') AS rule_name,
      r.event_id,
      r.status,
      r.created_at
    FROM public.automation_rule_runs r
    LEFT JOIN public.automation_rules ar ON ar.id = r.rule_id
    WHERE r.status = 'failed'
    ORDER BY r.created_at DESC
    LIMIT 5
  ) f;

  -- 7. Montagem do payload seguro
  v_result := jsonb_build_object(
    'pending_events', v_pending_count,
    'dead_events', v_dead_count,
    'oldest_pending_age_seconds', v_oldest_seconds,
    'last_cron_at', v_last_cron,
    'recent_failed_runs', v_failed_runs
  );

  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.fn_system_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_system_health() TO authenticated, service_role;
