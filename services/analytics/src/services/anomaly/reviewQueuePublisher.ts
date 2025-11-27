import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { DetectedAnomaly } from './anomalyDetection';

const logger = createLogger('anomaly-review-queue');

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

function calculatePriority(score: number, severity: DetectedAnomaly['severity']): number {
  const severityWeight = severity === 'critical' ? 1 : severity === 'high' ? 0.85 : severity === 'medium' ? 0.6 : 0.4;
  return Math.min(100, Math.round((score + severityWeight) * 50));
}

function mapSeverityToRisk(severity: DetectedAnomaly['severity']): RiskLevel {
  if (severity === 'critical') return 'critical';
  if (severity === 'high') return 'high';
  if (severity === 'medium') return 'medium';
  return 'low';
}

async function upsertReviewQueue(
  tenantId: TenantId,
  documentId: string,
  priorityScore: number,
  riskLevel: RiskLevel,
  riskFactors: string[],
  detectedAt: Date
): Promise<void> {
  const slaDeadline = new Date(detectedAt);
  if (riskLevel === 'critical') {
    slaDeadline.setHours(slaDeadline.getHours() + 2);
  } else if (riskLevel === 'high') {
    slaDeadline.setHours(slaDeadline.getHours() + 6);
  } else {
    slaDeadline.setHours(slaDeadline.getHours() + 24);
  }

  await db.query(
    `INSERT INTO review_queue (
      tenant_id, document_id, priority_score, risk_level, risk_factors, status, sla_deadline, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5::jsonb, 'pending', $6, $7, $7)
    ON CONFLICT (document_id) DO UPDATE SET
      priority_score = EXCLUDED.priority_score,
      risk_level = EXCLUDED.risk_level,
      risk_factors = EXCLUDED.risk_factors,
      sla_deadline = EXCLUDED.sla_deadline,
      updated_at = NOW()`,
    [tenantId, documentId, priorityScore, riskLevel, JSON.stringify(riskFactors), slaDeadline, detectedAt]
  );
}

export async function publishAnomaliesToReviewQueue(anomalies: DetectedAnomaly[]): Promise<number> {
  if (anomalies.length === 0) return 0;

  let queued = 0;
  for (const anomaly of anomalies) {
    const priorityScore = calculatePriority(anomaly.score, anomaly.severity);
    const riskLevel = mapSeverityToRisk(anomaly.severity);
    const riskFactors = [
      `anomaly:${anomaly.anomalyType}`,
      ...anomaly.signals,
    ];

    await upsertReviewQueue(anomaly.tenantId, anomaly.documentId, priorityScore, riskLevel, riskFactors, anomaly.detectedAt);
    queued += 1;
  }

  logger.info('Anomaly review items queued', { queued });
  return queued;
}
