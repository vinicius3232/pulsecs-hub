-- =========================================================================
-- PULSECS — RLS POR PERFIL (P0 de segurança)
-- Substitui as políticas "USING (true)" do schema.sql e reforça as de 0002/0003.
-- Perfis (csm_users.role): head | csm | is | viewer.
-- Regra de ouro: quem não está em csm_users (ou está inativo) NÃO acessa nada,
-- mesmo autenticado. Assim, um sign-up público do Supabase não dá acesso a dados.
-- Requer: schema.sql, 0002 e 0003. Idempotente.
-- =========================================================================

-- ---------------------------------------------------------------------------
-- 1. Funções auxiliares (SECURITY DEFINER: leem csm_users sem passar pela RLS dela,
--    o que evita recursão). Só devolvem dados do próprio usuário da sessão.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.csm_users WHERE auth_id = auth.uid() AND is_active LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_current_csm_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.csm_users WHERE auth_id = auth.uid() AND is_active LIMIT 1;
$$;

-- É equipe ativa (qualquer perfil)?
CREATE OR REPLACE FUNCTION public.fn_is_staff()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.csm_users WHERE auth_id = auth.uid() AND is_active);
$$;

-- Pode ESCREVER dados desta empresa?
--   head   -> qualquer empresa
--   csm    -> as suas e as sem gestor (para assumir)
--   is     -> empresas ainda em onboarding (fora de Go-Live)
--   viewer -> nunca
CREATE OR REPLACE FUNCTION public.fn_can_write_company(p_company UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE public.get_current_user_role()
    WHEN 'head' THEN EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company)
    WHEN 'csm'  THEN EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company
                              AND (c.csm_id = public.get_current_csm_id() OR c.csm_id IS NULL))
    WHEN 'is'   THEN EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company AND c.phase <> 'Go-Live')
    ELSE FALSE
  END;
$$;

REVOKE ALL ON FUNCTION public.get_current_user_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_current_csm_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_is_staff() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_can_write_company(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_user_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_current_csm_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_is_staff() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_can_write_company(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Defesa em profundidade: o papel anônimo não toca em nenhuma tabela do app
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.csm_users, public.companies, public.contacts, public.meetings,
              public.interactions, public.health_snapshots, public.event_log,
              public.automation_rules, public.automation_rule_runs, public.csm_tasks,
              public.automation_scheduled_steps, public.saved_views
  FROM anon;

-- ---------------------------------------------------------------------------
-- 3. csm_users — equipe lê; só o Head escreve
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "CSM users select policy" ON public.csm_users;
DROP POLICY IF EXISTS "Head CSM admin write policy" ON public.csm_users;
DROP POLICY IF EXISTS "csm_users staff read" ON public.csm_users;
DROP POLICY IF EXISTS "csm_users head write" ON public.csm_users;
CREATE POLICY "csm_users staff read" ON public.csm_users
  FOR SELECT TO authenticated USING (public.fn_is_staff());
CREATE POLICY "csm_users head write" ON public.csm_users
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'head')
  WITH CHECK (public.get_current_user_role() = 'head');

-- ---------------------------------------------------------------------------
-- 4. companies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Companies select policy" ON public.companies;
DROP POLICY IF EXISTS "Companies modify policy" ON public.companies;
DROP POLICY IF EXISTS "companies staff read" ON public.companies;
DROP POLICY IF EXISTS "companies insert" ON public.companies;
DROP POLICY IF EXISTS "companies update" ON public.companies;
DROP POLICY IF EXISTS "companies delete" ON public.companies;

CREATE POLICY "companies staff read" ON public.companies
  FOR SELECT TO authenticated USING (public.fn_is_staff());

-- Criar: head em qualquer carteira; csm só para si mesmo
CREATE POLICY "companies insert" ON public.companies
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_current_user_role() = 'head'
    OR (public.get_current_user_role() = 'csm' AND csm_id = public.get_current_csm_id())
  );

-- Editar: head tudo; csm as suas ou as sem gestor (e só pode deixá-las para si);
--         is as que ainda não estão em Go-Live
CREATE POLICY "companies update" ON public.companies
  FOR UPDATE TO authenticated
  USING (
    public.get_current_user_role() = 'head'
    OR (public.get_current_user_role() = 'csm'
        AND (csm_id = public.get_current_csm_id() OR csm_id IS NULL))
    OR (public.get_current_user_role() = 'is' AND phase <> 'Go-Live')
  )
  WITH CHECK (
    public.get_current_user_role() = 'head'
    OR (public.get_current_user_role() = 'csm' AND csm_id = public.get_current_csm_id())
    OR (public.get_current_user_role() = 'is')
  );

CREATE POLICY "companies delete" ON public.companies
  FOR DELETE TO authenticated USING (public.get_current_user_role() = 'head');

-- ---------------------------------------------------------------------------
-- 5. Tabelas filhas da empresa: leitura para a equipe; escrita via fn_can_write_company
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Contacts access policy" ON public.contacts;
DROP POLICY IF EXISTS "contacts staff read" ON public.contacts;
DROP POLICY IF EXISTS "contacts write" ON public.contacts;
CREATE POLICY "contacts staff read" ON public.contacts
  FOR SELECT TO authenticated USING (public.fn_is_staff());
CREATE POLICY "contacts write" ON public.contacts
  FOR ALL TO authenticated
  USING (public.fn_can_write_company(company_id))
  WITH CHECK (public.fn_can_write_company(company_id));

DROP POLICY IF EXISTS "Meetings access policy" ON public.meetings;
DROP POLICY IF EXISTS "meetings staff read" ON public.meetings;
DROP POLICY IF EXISTS "meetings write" ON public.meetings;
CREATE POLICY "meetings staff read" ON public.meetings
  FOR SELECT TO authenticated USING (public.fn_is_staff());
CREATE POLICY "meetings write" ON public.meetings
  FOR ALL TO authenticated
  USING (public.fn_can_write_company(company_id))
  WITH CHECK (public.fn_can_write_company(company_id));

DROP POLICY IF EXISTS "Interactions access policy" ON public.interactions;
DROP POLICY IF EXISTS "interactions staff read" ON public.interactions;
DROP POLICY IF EXISTS "interactions write" ON public.interactions;
CREATE POLICY "interactions staff read" ON public.interactions
  FOR SELECT TO authenticated USING (public.fn_is_staff());
-- Registrar interação: na empresa que pode escrever, sempre em nome próprio (head pode em nome de outro)
CREATE POLICY "interactions write" ON public.interactions
  FOR ALL TO authenticated
  USING (public.fn_can_write_company(company_id))
  WITH CHECK (
    public.fn_can_write_company(company_id)
    AND (public.get_current_user_role() = 'head'
         OR csm_id IS NULL OR csm_id = public.get_current_csm_id())
  );

-- Snapshots do Health Score: a equipe lê; ninguém escreve pelo navegador (só o service role)
DROP POLICY IF EXISTS "Snapshots access policy" ON public.health_snapshots;
DROP POLICY IF EXISTS "snapshots staff read" ON public.health_snapshots;
CREATE POLICY "snapshots staff read" ON public.health_snapshots
  FOR SELECT TO authenticated USING (public.fn_is_staff());

-- ---------------------------------------------------------------------------
-- 6. Automação (0002/0003): leitura só para a equipe; regras só o Head edita
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "rules select" ON public.automation_rules;
CREATE POLICY "rules select" ON public.automation_rules
  FOR SELECT TO authenticated USING (public.fn_is_staff());

DROP POLICY IF EXISTS "tasks select" ON public.csm_tasks;
CREATE POLICY "tasks select" ON public.csm_tasks
  FOR SELECT TO authenticated USING (public.fn_is_staff());

DROP POLICY IF EXISTS "views select" ON public.saved_views;
CREATE POLICY "views select" ON public.saved_views
  FOR SELECT TO authenticated
  USING (
    owner_id = public.get_current_csm_id()
    OR (is_shared AND public.fn_is_staff())
    OR public.get_current_user_role() = 'head'
  );

-- ---------------------------------------------------------------------------
-- 7. Tarefas: viewer não altera (a política de 0002 permitia a quem fosse "dono" da linha)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "tasks update" ON public.csm_tasks;
CREATE POLICY "tasks update" ON public.csm_tasks
  FOR UPDATE TO authenticated
  USING (
    public.get_current_user_role() = 'head'
    OR (public.get_current_user_role() IN ('csm', 'is') AND csm_id = public.get_current_csm_id())
  )
  WITH CHECK (
    public.get_current_user_role() = 'head'
    OR (public.get_current_user_role() IN ('csm', 'is') AND csm_id = public.get_current_csm_id())
  );

-- ---------------------------------------------------------------------------
-- 8. Restrição por coluna para o perfil "is" (a RLS decide linhas, não colunas):
--    o Implementation Specialist avança onboarding, mas não reatribui nem mexe em contrato/receita.
--    Só vale para sessões de usuário; o service role (auth.uid() nulo) não é afetado.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_companies_guard_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_current_user_role() = 'is' THEN
    IF NEW.csm_id IS DISTINCT FROM OLD.csm_id
       OR NEW.mrr IS DISTINCT FROM OLD.mrr
       OR NEW.pepm IS DISTINCT FROM OLD.pepm
       OR NEW.tier IS DISTINCT FROM OLD.tier
       OR NEW.renewal_date IS DISTINCT FROM OLD.renewal_date
       OR NEW.contract_start_date IS DISTINCT FROM OLD.contract_start_date THEN
      RAISE EXCEPTION 'perfil "is" não pode alterar gestor, valores ou contrato' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_companies_guard_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_companies_guard_columns ON public.companies;
CREATE TRIGGER trg_companies_guard_columns
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.fn_companies_guard_columns();
