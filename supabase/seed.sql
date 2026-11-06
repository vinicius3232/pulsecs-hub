-- =========================================================================
-- PULSECS ENTERPRISE — SEED DATA INICIAL
-- =========================================================================

-- Inserir os 3 CSMs iniciais
INSERT INTO public.csm_users (id, name, email, role, avatar_initials, color, status, max_accounts)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Vinícius M.', 'vinicius@pulsecs.com.br', 'head', 'VM', 'indigo', 'Em Reunião', 6),
  ('22222222-2222-2222-2222-222222222222', 'Camila Prado', 'camila@pulsecs.com.br', 'csm', 'CP', 'purple', 'Disponível', 5),
  ('33333333-3333-3333-3333-333333333333', 'Lucas Rocha', 'lucas@pulsecs.com.br', 'is', 'LR', 'emerald', 'Disponível', 6)
ON CONFLICT (email) DO NOTHING;

-- Inserir as 11 empresas com métricas de benefícios corporativos
INSERT INTO public.companies (
  id, name, tier, mrr, pepm, eligible_lives, active_lives, mau_lives, total_savings,
  phase, health_score, health_status, risk_reason, csm_id, contract_start_date, renewal_date
) VALUES
  ('a1111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Rede Mais Fidelidade', 'Enterprise', 14500.00, 18.50, 850, 714, 620, 48200.00, 'Treinamento', 82, 'green', 'Nenhum', '11111111-1111-1111-1111-111111111111', '2026-02-01', '2027-02-01'),
  ('b2222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Clube Prime Associados', 'Mid-Market', 8900.00, 16.00, 560, 210, 140, 9400.00, 'Config & Carga', 38, 'red', 'Sem login há 12 dias. Travou upload de base.', '33333333-3333-3333-3333-333333333333', '2026-04-10', '2027-04-10'),
  ('c3333333-cccc-cccc-cccc-cccccccccccc', 'NexStore Vantagens B2B', 'Enterprise', 18200.00, 19.00, 1200, 1110, 1040, 92600.00, 'Go-Live', 91, 'green', 'Nenhum (Campeão de Uso)', '11111111-1111-1111-1111-111111111111', '2025-11-15', '2026-11-15'),
  ('d4444444-dddd-dddd-dddd-dddddddddddd', 'Apex Logística Nacional', 'Enterprise', 12000.00, 15.00, 900, 396, 280, 18300.00, 'Kickoff', 44, 'red', 'Troca de liderança interna; novo diretor não conhece o software.', '22222222-2222-2222-2222-222222222222', '2026-05-01', '2027-05-01'),
  ('e5555555-eeee-eeee-eeee-eeeeeeeeeeee', 'InovaTech Soluções SaaS', 'Mid-Market', 7500.00, 17.50, 430, 292, 240, 24100.00, 'Go-Live', 68, 'yellow', 'Apenas 2 dos 8 administradores de RH estão ativos.', '22222222-2222-2222-2222-222222222222', '2026-03-20', '2027-03-20'),
  ('f6666666-ffff-ffff-ffff-ffffffffffff', 'Grupo Alfa Benefícios', 'Mid-Market', 9200.00, 16.50, 600, 444, 380, 31900.00, 'Go-Live', 74, 'yellow', 'Queda de 8% nos acessos semanais.', '33333333-3333-3333-3333-333333333333', '2026-01-10', '2027-01-10'),
  ('a7777777-0000-0000-0000-000000000000', 'OmniVarejo Brasil', 'Enterprise', 11400.00, 18.00, 780, 690, 640, 53400.00, 'Go-Live', 88, 'green', 'Nenhum', '11111111-1111-1111-1111-111111111111', '2025-12-05', '2026-12-05'),
  ('b8888888-0000-0000-0000-000000000000', 'HealthCare Seguros & Saúde', 'Enterprise', 15000.00, 20.00, 800, 704, 660, 61200.00, 'Go-Live', 85, 'green', 'Nenhum', '22222222-2222-2222-2222-222222222222', '2026-02-15', '2027-02-15'),
  ('c9999999-0000-0000-0000-000000000000', 'AgroSul Tecnologia Rural', 'SMB', 3800.00, 15.00, 250, 198, 175, 14800.00, 'Go-Live', 79, 'green', 'Nenhum', '33333333-3333-3333-3333-333333333333', '2026-03-01', '2027-03-01'),
  ('d0000000-0000-0000-0000-000000000000', 'Delta Pay Soluções Financeiras', 'SMB', 4500.00, 16.00, 310, 251, 230, 21900.00, 'Go-Live', 81, 'green', 'Nenhum', '11111111-1111-1111-1111-111111111111', '2026-04-01', '2027-04-01'),
  ('e1111111-0000-0000-0000-000000000000', 'Vanguarda Educacional', 'SMB', 4200.00, 15.50, 280, 218, 190, 17200.00, 'Go-Live', 78, 'green', 'Nenhum', '22222222-2222-2222-2222-222222222222', '2026-05-10', '2027-05-10')
ON CONFLICT (id) DO NOTHING;

-- Inserir contatos de RH / Decisores
INSERT INTO public.contacts (company_id, name, role, email, phone, is_decision_maker) VALUES
  ('a1111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Roberto Silva', 'Diretor de Operações', 'roberto@redemaisfidelidade.com.br', '5511987654321', true),
  ('b2222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Patrícia Lima', 'Coordenadora de RH', 'patricia@clubeprime.com.br', '5511991234567', false),
  ('c3333333-cccc-cccc-cccc-cccccccccccc', 'Carlos Eduardo', 'CTO & Head People', 'carlos@nexstore.com.br', '5521988776655', true),
  ('d4444444-dddd-dddd-dddd-dddddddddddd', 'Marcos Vinícius', 'Gerente de RH & Ops', 'marcos@apexlog.com.br', '5531998881122', false),
  ('e5555555-eeee-eeee-eeee-eeeeeeeeeeee', 'Juliana Costa', 'Product Owner & RH', 'juliana@inovatech.io', '5541977665544', false);
