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

CREATE POLICY "Interactions access policy" ON public.interactions
  FOR ALL TO authenticated USING (true);

CREATE POLICY "Snapshots access policy" ON public.health_snapshots
  FOR ALL TO authenticated USING (true);
