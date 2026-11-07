/**
 * Alerta e monitoramento da saúde da fila de eventos e automação (D4).
 * Avalia limites configuráveis de eventos pendentes, atrasos e eventos mortos.
 */

export interface QueueStats {
  pendingEvents: number;
  oldestAgeSeconds: number;
  deadEvents: number;
}

export interface QueueAlertConfig {
  maxPending?: number;        // default: 50
  maxAgeSeconds?: number;     // default: 3600 (1 hora)
  maxDead?: number;           // default: 0
}

export interface QueueAlertResult {
  alert: boolean;
  severity: 'critical' | 'warn' | null;
  reasons: string[];
  taskTitle: string | null;
  noticeText: string | null;
  dedupeKey: string;
}

export const DEFAULT_ALERT_CONFIG: Required<QueueAlertConfig> = {
  maxPending: 50,
  maxAgeSeconds: 3600,
  maxDead: 0
};

export function checkQueueHealthAlert(
  stats: QueueStats,
  customConfig?: QueueAlertConfig
): QueueAlertResult {
  const cfg = { ...DEFAULT_ALERT_CONFIG, ...(customConfig || {}) };
  const reasons: string[] = [];
  let severity: 'critical' | 'warn' | null = null;

  if (stats.deadEvents > cfg.maxDead) {
    reasons.push(`${stats.deadEvents} evento(s) mortos (dead) na fila de automação`);
    severity = 'critical';
  }

  if (stats.pendingEvents > cfg.maxPending) {
    reasons.push(`Fila de eventos com ${stats.pendingEvents} itens pendentes (limite: ${cfg.maxPending})`);
    if (!severity) severity = 'critical';
  }

  if (stats.oldestAgeSeconds > cfg.maxAgeSeconds && stats.pendingEvents > 0) {
    const min = Math.round(stats.oldestAgeSeconds / 60);
    reasons.push(`Atraso de processamento do evento mais antigo: ${min} min (limite: ${Math.round(cfg.maxAgeSeconds / 60)} min)`);
    if (severity !== 'critical') severity = 'warn';
  }

  if (reasons.length === 0) {
    return {
      alert: false,
      severity: null,
      reasons: [],
      taskTitle: null,
      noticeText: null,
      dedupeKey: 'system_health_queue_alert'
    };
  }

  const primaryReason = reasons[0];
  return {
    alert: true,
    severity: severity || 'warn',
    reasons,
    taskTitle: `[Alerta de Sistema] ${primaryReason}`,
    noticeText: `Atenção: A fila de automações requer revisão. ${reasons.join('. ')}.`,
    dedupeKey: 'system_health_queue_alert'
  };
}

export function formatHealthAge(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours}h ${remMinutes}min` : `${hours}h`;
}

export function systemHealthStatus(stats: QueueStats): 'green' | 'yellow' | 'red' {
  if (stats.deadEvents > 0 || stats.pendingEvents > 50 || stats.oldestAgeSeconds > 7200) {
    return 'red';
  }
  if (stats.pendingEvents > 10 || stats.oldestAgeSeconds > 1800) {
    return 'yellow';
  }
  return 'green';
}
