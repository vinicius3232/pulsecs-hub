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

export function calculateAdoptionHealthScore(input: HealthScoreInput): HealthScoreResult {
  const {
    eligible_lives,
    active_lives,
    mau_lives,
    rh_last_login_days,
    days_to_renewal,
    has_overdue_invoice = false
  } = input;
  const nps_score = input.nps_score ?? 8; // null/undefined = padrão 8 (igual ao banco)

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
    0.35 * s_ativ +
    0.25 * s_mau +
    0.15 * s_rh +
    0.15 * s_renov +
    0.10 * s_nps
  );

  // Penalidade de inadimplência financeira (-25 pontos)
  if (has_overdue_invoice) {
    totalScore = Math.max(0, totalScore - 25);
    risk_factors.push('Fatura em atraso / Inadimplência financeira');
  }

  // Determinação de status
  let status: 'green' | 'yellow' | 'red' = 'green';
  if (totalScore >= 75) status = 'green';
  else if (totalScore >= 50) status = 'yellow';
  else status = 'red';

  return {
    score: totalScore,
    status,
    activation_rate,
    mau_rate,
    risk_factors
  };
}
