-- =========================================================================
-- PULSECS — IDEMPOTÊNCIA DE PASSOS DE AUTOMAÇÃO (D3)
-- Garante que passos como add_note e http_request não executem mais de uma vez
-- caso o processo sofra queda após o efeito e antes da confirmação da execução.
-- A chave de idempotência por (regra, evento, passo) é reservada ANTES do efeito.
-- Idempotente.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.automation_step_idempotency (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.event_log(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')) DEFAULT 'started',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (rule_id, event_id, step_key)
);

CREATE INDEX IF NOT EXISTS idx_step_idempotency_created ON public.automation_step_idempotency(created_at);
CREATE INDEX IF NOT EXISTS idx_step_idempotency_lookup ON public.automation_step_idempotency(rule_id, event_id, step_key);

-- Proteção de acesso: apenas o motor de automação (service role) acessa esta tabela de controle interno
ALTER TABLE public.automation_step_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_step_idempotency FROM anon, authenticated;
GRANT ALL ON public.automation_step_idempotency TO service_role;

-- Limpeza periódica de chaves antigas (retenção de 90 dias alinhada com webhook_deliveries)
CREATE OR REPLACE FUNCTION public.fn_purge_step_idempotency(p_days INT DEFAULT 90)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INT;
BEGIN
  DELETE FROM public.automation_step_idempotency WHERE created_at < NOW() - make_interval(days => p_days);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.fn_purge_step_idempotency(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_purge_step_idempotency(INT) TO service_role;
