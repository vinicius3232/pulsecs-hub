-- =========================================================================
-- PULSECS ENTERPRISE — SUPABASE POSTGRESQL SCHEMA (FASE 1)
-- Orientado à Adoção de Colaboradores e Renovação em Benefícios Corporativos
-- =========================================================================

-- Extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. TABELA: csm_users (Perfis de Usuários & Equipe de CS)
CREATE TABLE IF NOT EXISTS public.csm_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'csm' CHECK (role IN ('head', 'csm', 'is', 'viewer')),
  avatar_initials TEXT NOT NULL DEFAULT 'CS',
  color TEXT NOT NULL DEFAULT 'indigo',
  status TEXT NOT NULL DEFAULT 'Disponível' CHECK (status IN ('Disponível', 'Em Reunião', 'Férias', 'Sobrecarga')),
  max_accounts INT NOT NULL DEFAULT 6,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. TABELA: companies (Empresas Clientes de Benefícios)
CREATE TABLE IF NOT EXISTS public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  cnpj TEXT UNIQUE,
  tier TEXT NOT NULL DEFAULT 'Mid-Market' CHECK (tier IN ('SMB', 'Mid-Market', 'Enterprise')),
  mrr NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  pepm NUMERIC(8,2) NOT NULL DEFAULT 0.00, -- Preço cobrado por colaborador/vida por mês
  
  -- Métricas de Adoção de Benefícios (Fase 2)
  eligible_lives INT NOT NULL DEFAULT 0,    -- Total de colaboradores cadastrados pelo RH
  active_lives INT NOT NULL DEFAULT 0,      -- Colaboradores com login/cartão ativo
  mau_lives INT NOT NULL DEFAULT 0,         -- Colaboradores que usaram no último mês
  total_savings NUMERIC(12,2) DEFAULT 0.00, -- Economia gerada acumulada para os colaboradores (ROI)
  
  -- Ciclo de Vida e Saúde
  phase TEXT NOT NULL DEFAULT 'Kickoff' CHECK (phase IN ('Kickoff', 'Config & Carga', 'Treinamento', 'Go-Live')),
  health_score INT NOT NULL DEFAULT 85 CHECK (health_score BETWEEN 0 AND 100),
  health_status TEXT NOT NULL DEFAULT 'green' CHECK (health_status IN ('green', 'yellow', 'red')),
  risk_reason TEXT,
  last_login_at TIMESTAMPTZ DEFAULT NOW(),
  contract_start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  renewal_date DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '1 year'),
  
  -- Relacionamentos
  csm_id UUID REFERENCES public.csm_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. TABELA: contacts (Contatos B2B: RH, Financeiro e Decisores)
CREATE TABLE IF NOT EXISTS public.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Gestor de RH', -- 'Diretor', 'RH', 'Financeiro', 'TI'
  email TEXT NOT NULL,
  phone TEXT, -- WhatsApp formatado
  is_decision_maker BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. TABELA: meetings (Reuniões, Agendamentos & Briefings IA)
CREATE TABLE IF NOT EXISTS public.meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  csm_id UUID REFERENCES public.csm_users(id) ON DELETE SET NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  meeting_type TEXT NOT NULL DEFAULT 'Alinhamento' CHECK (meeting_type IN ('Kickoff', 'Treinamento', 'Alinhamento', 'QBR', 'Risco')),
  subject TEXT NOT NULL,
  ai_briefing TEXT,
  meet_url TEXT DEFAULT 'https://meet.google.com/new',
  notes TEXT,
  next_action TEXT,
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. TABELA: interactions (Régua Omnichannel: Histórico de Contato WhatsApp/Email/Salez)
CREATE TABLE IF NOT EXISTS public.interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  csm_id UUID REFERENCES public.csm_users(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'email', 'salez_agent', 'call', 'note')),
  trigger_type TEXT NOT NULL, -- 'churn_rescue', 'onboarding_unlock', 'qbr_invite', etc.
  content TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('draft', 'sent', 'delivered', 'replied'))
);

-- 6. TABELA: health_snapshots (Histórico Diário/Semanal de Tendência de Score)
CREATE TABLE IF NOT EXISTS public.health_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  health_score INT NOT NULL,
  activation_rate NUMERIC(5,2),
  mau_rate NUMERIC(5,2),
  total_savings NUMERIC(12,2),
  rh_engagement_score INT,
  recorded_at DATE NOT NULL DEFAULT CURRENT_DATE
);

-- =========================================================================
-- ÍNDICES DE PERFORMANCE
-- =========================================================================
CREATE INDEX IF NOT EXISTS idx_companies_csm ON public.companies(csm_id);
CREATE INDEX IF NOT EXISTS idx_companies_health_status ON public.companies(health_status);
CREATE INDEX IF NOT EXISTS idx_companies_renewal ON public.companies(renewal_date);
CREATE INDEX IF NOT EXISTS idx_meetings_company ON public.meetings(company_id);
CREATE INDEX IF NOT EXISTS idx_meetings_scheduled_at ON public.meetings(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_health_snapshots_company_date ON public.health_snapshots(company_id, recorded_at);

-- =========================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =========================================================================
ALTER TABLE public.csm_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_snapshots ENABLE ROW LEVEL SECURITY;

-- Helper function: Obter role do usuário autenticado atual
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT role FROM public.csm_users WHERE auth_id = auth.uid() LIMIT 1;
$$;

-- Helper function: Obter csm_id do usuário autenticado atual
CREATE OR REPLACE FUNCTION public.get_current_csm_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT id FROM public.csm_users WHERE auth_id = auth.uid() LIMIT 1;
$$;

-- Políticas para csm_users:
-- Qualquer usuário autenticado pode ler a lista de CSMs (para ver equipe e balanceamento)
CREATE POLICY "CSM users select policy" ON public.csm_users
  FOR SELECT TO authenticated USING (true);

-- Apenas Head pode criar ou editar CSMs
CREATE POLICY "Head CSM admin write policy" ON public.csm_users
  FOR ALL TO authenticated USING (public.get_current_user_role() = 'head');

-- Políticas para companies:
-- Head e Viewers veem todas as empresas; CSMs veem todas ou as suas dependendo do filtro
CREATE POLICY "Companies select policy" ON public.companies
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Companies modify policy" ON public.companies
  FOR ALL TO authenticated USING (
    public.get_current_user_role() = 'head' OR 
    csm_id = public.get_current_csm_id() OR
    csm_id IS NULL
  );

-- Políticas para meetings:
CREATE POLICY "Meetings access policy" ON public.meetings
  FOR ALL TO authenticated USING (true);

-- Políticas para contacts e interactions:
CREATE POLICY "Contacts access policy" ON public.contacts
  FOR ALL TO authenticated USING (true);

-- Políticas para interactions:
CREATE POLICY "Interactions access policy" ON public.interactions
  FOR ALL TO authenticated USING (true);

CREATE POLICY "Snapshots access policy" ON public.health_snapshots
  FOR ALL TO authenticated USING (true);

-- 7. TABELA: company_external_mappings (Fase B)
CREATE TABLE IF NOT EXISTS public.company_external_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  platform_name TEXT NOT NULL DEFAULT 'benefits_platform',
  external_platform_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.csm_users(id) ON DELETE SET NULL,
  CONSTRAINT uq_platform_external_id UNIQUE (platform_name, external_platform_id)
);

-- 8. TABELA: unmatched_metrics (Fase B)
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
  hits INT NOT NULL DEFAULT 1,              -- reenvios da mesma pendência (0008)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Políticas, funções (fn_enqueue/resolve/purge_unmatched) e a calibração ativa vêm das migrations 0007 e 0008.

-- 9. TABELA: health_config (Fase B)
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

-- 10. TABELA: automation_step_idempotency (Fase D3)
CREATE TABLE IF NOT EXISTS public.automation_step_idempotency (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL,
  event_id UUID NOT NULL,
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
