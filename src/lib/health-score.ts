/**
 * PulseCS — Cálculo Ponderado de Health Score por Adoção de Benefícios
 * Fórmula aprovada na Fase 0 (ADR-0015)
 */

export interface HealthScoreInput {
  eligible_lives: number;       // Vidas totais
  active_lives: number;         // Vidas ativadas
  mau_lives: number;            // Vidas com uso no mês
  rh_last_login_days: number | null;   // Dias desde o último login do RH (null = nunca logou)
  days_to_renewal: number;      // Dias até a renovação
  nps_score?: number;           // NPS (0 a 10)
  has_overdue_invoice?: boolean;// Inadimplência
}

export interface HealthScoreResult {
  score: number;
  status: 'green' | 'yellow' | 'red';
  activation_rate: number;
  mau_rate: number;
  risk_factors: string[];
}

export interface HealthScoreConfig {
  weight_activation?: number;
  weight_mau?: number;
  weight_rh?: number;
  weight_renewal?: number;
  weight_nps?: number;
  penalty_overdue?: number;
  threshold_green?: number;
  threshold_yellow?: number;
}

export const DEFAULT_HEALTH_CONFIG: Required<HealthScoreConfig> = {
  weight_activation: 0.35,
  weight_mau: 0.25,
  weight_rh: 0.15,
  weight_renewal: 0.15,
  weight_nps: 0.10,
  penalty_overdue: 25,
  threshold_green: 75,
  threshold_yellow: 50
};

export function calculateAdoptionHealthScore(
  input: HealthScoreInput,
  config?: HealthScoreConfig
): HealthScoreResult {
  const {
    eligible_lives,
    active_lives,
    mau_lives,
    rh_last_login_days,
    days_to_renewal,
    has_overdue_invoice = false
  } = input;
  const nps_score = input.nps_score ?? 8; // null/undefined = padrão 8 (igual ao banco)

  const w_act = config?.weight_activation ?? DEFAULT_HEALTH_CONFIG.weight_activation;
  const w_mau = config?.weight_mau ?? DEFAULT_HEALTH_CONFIG.weight_mau;
  const w_rh = config?.weight_rh ?? DEFAULT_HEALTH_CONFIG.weight_rh;
  const w_renov = config?.weight_renewal ?? DEFAULT_HEALTH_CONFIG.weight_renewal;
  const w_nps = config?.weight_nps ?? DEFAULT_HEALTH_CONFIG.weight_nps;
  const penalty = config?.penalty_overdue ?? DEFAULT_HEALTH_CONFIG.penalty_overdue;
  const thresh_green = config?.threshold_green ?? DEFAULT_HEALTH_CONFIG.threshold_green;
  const thresh_yellow = config?.threshold_yellow ?? DEFAULT_HEALTH_CONFIG.threshold_yellow;

  const risk_factors: string[] = [];

  // 1. Taxa de Ativação (Peso: 0.35)
  const activation_rate = eligible_lives > 0 ? (active_lives / eligible_lives) * 100 : 0;
  let s_ativ = 0;
  if (activation_rate >= 80) s_ativ = 100;
  else if (activation_rate >= 50) s_ativ = 60;
  else {
    s_ativ = 25;
    risk_factors.push(`Ativação de colaboradores crítica (${activation_rate.toFixed(1)}% < 50%)`);
  }

  // 2. Taxa de MAU (Uso Mensal) (Peso: 0.25)
  const mau_rate = active_lives > 0 ? (mau_lives / active_lives) * 100 : 0;
  let s_mau = 0;
  if (mau_rate >= 75) s_mau = 100;
  else if (mau_rate >= 45) s_mau = 60;
  else {
    s_mau = 20;
    risk_factors.push(`Uso mensal estagnado (${mau_rate.toFixed(1)}% dos ativados usam)`);
  }

  // 3. Engajamento do Gestor de RH (Peso: 0.15)
  let s_rh = 0;
  if (rh_last_login_days === null || rh_last_login_days === undefined) {
    s_rh = 40;
    risk_factors.push('Gestor de RH ainda sem login registrado');
  } else if (rh_last_login_days <= 7) s_rh = 100;
  else if (rh_last_login_days <= 14) s_rh = 70;
  else if (rh_last_login_days <= 30) {
    s_rh = 40;
    risk_factors.push(`Gestor de RH ausente há ${rh_last_login_days} dias`);
  } else {
    s_rh = 10;
    risk_factors.push(`Abandono operacional do RH (${rh_last_login_days} dias sem login)`);
  }

  // 4. Proximidade de Renovação (Peso: 0.15)
  let s_renov = 100;
  if (days_to_renewal <= 60) {
    if (activation_rate < 60 || mau_rate < 50) {
      s_renov = 20;
      risk_factors.push(`Vencimento próximo (${days_to_renewal} dias) com baixa adoção`);
    } else {
      s_renov = 80;
    }
  }

  // 5. NPS (Peso: 0.10)
  let s_nps = 70;
  if (nps_score >= 9) s_nps = 100;
  else if (nps_score >= 7) s_nps = 60;
  else {
    s_nps = 10;
    risk_factors.push(`Cliente detrator no último NPS (${nps_score}/10)`);
  }

  // Cálculo ponderado
  let totalScore = Math.round(
    w_act * s_ativ +
    w_mau * s_mau +
    w_rh * s_rh +
    w_renov * s_renov +
    w_nps * s_nps
  );

  // Penalidade de inadimplência financeira (-25 pontos padrão ou calibrado)
  if (has_overdue_invoice) {
    totalScore = Math.max(0, totalScore - penalty);
    risk_factors.push('Fatura em atraso / Inadimplência financeira');
  }

  // Determinação de status conforme limiares
  let status: 'green' | 'yellow' | 'red' = 'green';
  if (totalScore >= thresh_green) status = 'green';
  else if (totalScore >= thresh_yellow) status = 'yellow';
  else status = 'red';

  return {
    score: totalScore,
    status,
    activation_rate,
    mau_rate,
    risk_factors
  };
}
