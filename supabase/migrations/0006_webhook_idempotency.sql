-- =========================================================================
-- PULSECS — IDEMPOTÊNCIA DE WEBHOOKS (substitui a deduplicação por nome)
-- Cada entrega recebida (ex.: negócio ganho da Salez) reserva uma chave ÚNICA antes de criar qualquer
-- coisa: duas entregas simultâneas ou um reenvio nunca criam a empresa duas vezes, e empresas
-- homônimas (mesmo nome, negócios diferentes) não são confundidas.
-- Requer: schema.sql e 0002..0005. Idempotente.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (char_length(source) BETWEEN 1 AND 40),
  external_id TEXT NOT NULL CHECK (char_length(external_id) BETWEEN 1 AND 200),
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A reserva É a trava: o segundo INSERT leva 23505 e não executa nada
  UNIQUE (source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created ON public.webhook_deliveries(created_at);

-- Só o service role (funções /api) toca nesta tabela
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webhook_deliveries FROM anon, authenticated;

-- Retenção: o cron pode chamar para não crescer sem limite (90 dias bastam para reenvios)
CREATE OR REPLACE FUNCTION public.fn_purge_webhook_deliveries(p_days INT DEFAULT 90)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INT;
BEGIN
  DELETE FROM webhook_deliveries WHERE created_at < NOW() - make_interval(days => p_days);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.fn_purge_webhook_deliveries(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_purge_webhook_deliveries(INT) TO service_role;
