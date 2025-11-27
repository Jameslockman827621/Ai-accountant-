import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, DocumentId } from '@ai-accountant/shared-types';
import { publishAnomaliesToReviewQueue } from './reviewQueuePublisher';

export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical';

export interface DetectedAnomaly {
  tenantId: TenantId;
  documentId: DocumentId;
  anomalyType: 'quality' | 'compliance' | 'statistical';
  severity: AnomalySeverity;
  score: number;
  signals: string[];
  detectedAt: Date;
}

const logger = createLogger('anomaly-detection');

export async function detectAnomalies(tenantId: TenantId): Promise<DetectedAnomaly[]> {
  const anomalies: DetectedAnomaly[] = [];

  const qualityOutliers = await db.query<{
    document_id: DocumentId;
    accuracy_score: number;
    compliance_risk_score: number;
    composite_quality_score: number;
  }>(
    `SELECT document_id, accuracy_score, compliance_risk_score, composite_quality_score
     FROM quality_metrics qm
     JOIN documents d ON d.id = qm.document_id
     WHERE d.tenant_id = $1
       AND (accuracy_score < 0.6 OR compliance_risk_score > 0.35 OR composite_quality_score < 0.65)
     ORDER BY compliance_risk_score DESC, accuracy_score ASC
     LIMIT 50`,
    [tenantId]
  );

  for (const row of qualityOutliers.rows) {
    const signals: string[] = [];
    if (row.accuracy_score < 0.6) signals.push('Low accuracy score');
    if (row.compliance_risk_score > 0.35) signals.push('Elevated compliance risk');
    if (row.composite_quality_score < 0.65) signals.push('Composite quality degradation');

    const severity: AnomalySeverity = row.compliance_risk_score > 0.6
      ? 'critical'
      : row.compliance_risk_score > 0.45 || row.accuracy_score < 0.5
        ? 'high'
        : 'medium';

    anomalies.push({
      tenantId,
      documentId: row.document_id,
      anomalyType: 'quality',
      severity,
      score: Math.max(1 - row.accuracy_score, row.compliance_risk_score),
      signals,
      detectedAt: new Date(),
    });
  }

  const complianceFlags = await db.query<{
    document_id: DocumentId;
    flag_reason: string;
    risk_level: string;
    confidence: number;
  }>(
    `SELECT document_id, flag_reason, risk_level, confidence
     FROM document_compliance_flags f
     JOIN documents d ON d.id = f.document_id
     WHERE d.tenant_id = $1 AND (risk_level = 'high' OR confidence < 0.5)
     ORDER BY confidence ASC
     LIMIT 25`,
    [tenantId]
  );

  for (const row of complianceFlags.rows) {
    anomalies.push({
      tenantId,
      documentId: row.document_id,
      anomalyType: 'compliance',
      severity: row.risk_level === 'high' ? 'high' : 'medium',
      score: 1 - row.confidence,
      signals: [`Compliance flag: ${row.flag_reason}`],
      detectedAt: new Date(),
    });
  }

  logger.info('Anomalies detected', { tenantId, count: anomalies.length });
  return anomalies;
}

export async function runAnomalyDetectionJob(tenantId: TenantId): Promise<{ detected: number; queued: number; signals: DetectedAnomaly[] }> {
  const detected = await detectAnomalies(tenantId);
  const queued = await publishAnomaliesToReviewQueue(detected);

  return { detected: detected.length, queued, signals: detected };
}
