export type CompanyTier = 'SMB' | 'Mid-Market' | 'Enterprise';
export type OnboardingPhase = 'Kickoff' | 'Config & Carga' | 'Treinamento' | 'Go-Live';
export type HealthStatus = 'green' | 'yellow' | 'red';
export type CSMRole = 'head' | 'csm' | 'is' | 'viewer';

export interface Company {
  id: string | number;
  name: string;
  cnpj?: string;
  tier: CompanyTier;
  mrr: number;
  pepm: number; // Preço cobrado por vida/mês
  eligible_lives: number; // Vidas totais da empresa
  active_lives: number;   // Vidas com login / cartão ativo
  mau_lives: number;      // Vidas ativas no mês (MAU)
  total_savings: number;  // Economia total gerada para colaboradores
  phase: OnboardingPhase;
  health_score: number;
  health_status: HealthStatus;
  risk_reason?: string;
  last_login?: string;
  contact_name: string;
  contact_role: string;
  contact_email: string;
  contact_phone: string;
  csm_id: string | number;
  contract_start_date?: string;
  renewal_date?: string;
}

export interface CSMUser {
  id: string | number;
  name: string;
  email: string;
  role: CSMRole;
  avatar_initials: string;
  color: string;
  status: 'Disponível' | 'Em Reunião' | 'Férias' | 'Sobrecarga';
  max_accounts: number;
}

export interface MeetingEvent {
  id: string | number;
  company_id: string | number;
  company_name: string;
  day: number;
  time: string;
  subject: string;
  type: 'Kickoff' | 'Treinamento' | 'Alinhamento' | 'QBR' | 'Risco';
  status: HealthStatus;
  health_score: number;
  briefing: string;
  contact: string;
  meet_url: string;
  notes?: string;
}

export interface HealthSnapshot {
  id: string;
  company_id: string;
  health_score: number;
  activation_rate: number;
  mau_rate: number;
  total_savings: number;
  recorded_at: string;
}
