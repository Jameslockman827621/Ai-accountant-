import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { DocumentId, TenantId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('quality-metrics');

export interface QualityMetrics {
  accuracyScore: number; // 0-1
  completenessScore: number; // 0-1
  complianceRiskScore: number; // 0-1 (0 = no risk, 1 = high risk)
  compositeQualityScore: number; // Weighted composite
  fieldLevelMetrics: Record<
    string,
    {
      accuracy: number;
      completeness: number;
      confidence: number;
    }
  >;
}

export class QualityMetricsService {
  /**
   * Calculate quality metrics for a document
   */
  async calculateMetrics(
    tenantId: TenantId,
    documentId: DocumentId,
    extractedData: Record<string, unknown>,
    fieldConfidences: Record<string, number>,
    modelVersion?: string
  ): Promise<QualityMetrics> {
    // Calculate field-level metrics
    const fieldLevelMetrics: QualityMetrics['fieldLevelMetrics'] = {};

    const requiredFields = this.getRequiredFields(extractedData);
    let totalAccuracy = 0;
    let totalCompleteness = 0;
    let fieldCount = 0;

    for (const [fieldName, value] of Object.entries(extractedData)) {
      const confidence = fieldConfidences[fieldName] || 0.5;
      const isComplete = value !== null && value !== undefined && value !== '';

      // Field accuracy (based on confidence)
      const fieldAccuracy = confidence;

      // Field completeness
      const fieldCompleteness = isComplete ? 1 : 0;

      fieldLevelMetrics[fieldName] = {
        accuracy: fieldAccuracy,
        completeness: fieldCompleteness,
        confidence,
      };

      totalAccuracy += fieldAccuracy;
      totalCompleteness += fieldCompleteness;
      fieldCount++;
    }

    // Overall accuracy (average of field accuracies)
    const accuracyScore = fieldCount > 0 ? totalAccuracy / fieldCount : 0;

    // Overall completeness (percentage of required fields present)
    const completenessScore =
      requiredFields.length > 0
        ? requiredFields.filter((field) => extractedData[field] !== null && extractedData[field] !== undefined && extractedData[field] !== '').length /
          requiredFields.length
        : 1;

    // Compliance risk (based on missing critical fields, low confidence on amounts/dates)
    const complianceRiskScore = this.calculateComplianceRisk(
      extractedData,
      fieldConfidences,
      requiredFields
    );

    // Composite quality score (weighted)
    const compositeQualityScore =
      accuracyScore * 0.4 + completenessScore * 0.4 + (1 - complianceRiskScore) * 0.2;

    const metrics: QualityMetrics = {
      accuracyScore,
      completenessScore,
      complianceRiskScore,
      compositeQualityScore,
      fieldLevelMetrics,
    };

    // Store metrics
    await this.storeMetrics(documentId, metrics, modelVersion);

    logger.info('Quality metrics calculated', {
      documentId,
      accuracyScore,
      completenessScore,
      complianceRiskScore,
      compositeQualityScore,
    });

    return metrics;
  }

  /**
   * Calculate compliance risk score
   */
  private calculateComplianceRisk(
    extractedData: Record<string, unknown>,
    fieldConfidences: Record<string, number>,
    requiredFields: string[]
  ): number {
    let riskScore = 0;
    let riskFactors = 0;

    // Missing required fields
    const missingFields = requiredFields.filter(
      (field) => !extractedData[field] || extractedData[field] === ''
    );
    riskScore += missingFields.length * 0.2;
    riskFactors += missingFields.length;

    // Low confidence on critical fields
    const criticalFields = ['date', 'total', 'tax', 'vendor', 'invoiceNumber'];
    for (const field of criticalFields) {
      if (extractedData[field]) {
        const confidence = fieldConfidences[field] || 0;
        if (confidence < 0.7) {
          riskScore += (0.7 - confidence) * 0.3;
          riskFactors++;
        }
      }
    }

    // Amount inconsistencies
    if (extractedData.total && extractedData.tax && extractedData.subtotal) {
      const total = parseFloat(String(extractedData.total)) || 0;
      const tax = parseFloat(String(extractedData.tax)) || 0;
      const subtotal = parseFloat(String(extractedData.subtotal)) || 0;

      const expectedTotal = subtotal + tax;
      if (Math.abs(total - expectedTotal) > 0.01) {
        riskScore += 0.3;
        riskFactors++;
      }
    }

    // Normalize to 0-1 scale
    return Math.min(1, riskScore);
  }

  /**
   * Get required fields based on document type
   */
  private getRequiredFields(extractedData: Record<string, unknown>): string[] {
    // Base required fields
    const baseFields = ['date', 'total'];

    // Add type-specific fields
    if (extractedData.documentType === 'invoice') {
      return [...baseFields, 'vendor', 'invoiceNumber', 'tax'];
    }
    if (extractedData.documentType === 'receipt') {
      return [...baseFields, 'vendor'];
    }

    return baseFields;
  }

  /**
   * Store quality metrics
   */
  private async storeMetrics(
    documentId: DocumentId,
    metrics: QualityMetrics,
    modelVersion?: string
  ): Promise<void> {
    await db.query(
      `INSERT INTO quality_metrics (
        id, document_id, accuracy_score, completeness_score, compliance_risk_score,
        composite_quality_score, field_level_metrics, calculated_at, model_version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), $8)
      ON CONFLICT (document_id) DO UPDATE SET
        accuracy_score = EXCLUDED.accuracy_score,
        completeness_score = EXCLUDED.completeness_score,
        compliance_risk_score = EXCLUDED.compliance_risk_score,
        composite_quality_score = EXCLUDED.composite_quality_score,
        field_level_metrics = EXCLUDED.field_level_metrics,
        calculated_at = NOW(),
        model_version = EXCLUDED.model_version`,
      [
        randomUUID(),
        documentId,
        metrics.accuracyScore,
        metrics.completenessScore,
        metrics.complianceRiskScore,
        metrics.compositeQualityScore,
        JSON.stringify(metrics.fieldLevelMetrics),
        modelVersion || null,
      ]
    );
  }

  /**
   * Get quality metrics for a document
   */
  async getMetrics(documentId: DocumentId): Promise<QualityMetrics | null> {
    const result = await db.query<{
      accuracy_score: number;
      completeness_score: number;
      compliance_risk_score: number;
      composite_quality_score: number;
      field_level_metrics: unknown;
    }>(
      `SELECT accuracy_score, completeness_score, compliance_risk_score,
              composite_quality_score, field_level_metrics
       FROM quality_metrics
       WHERE document_id = $1`,
      [documentId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      accuracyScore: parseFloat(row.accuracy_score.toString()),
      completenessScore: parseFloat(row.completeness_score.toString()),
      complianceRiskScore: parseFloat(row.compliance_risk_score.toString()),
      compositeQualityScore: parseFloat(row.composite_quality_score.toString()),
      fieldLevelMetrics: (row.field_level_metrics as QualityMetrics['fieldLevelMetrics']) || {},
    };
  }

  /**
   * Get quality statistics for a tenant
   */
  async getQualityStats(
    tenantId: TenantId,
    startDate?: Date,
    endDate?: Date
  ): Promise<{
    averageAccuracy: number;
    averageCompleteness: number;
    averageComplianceRisk: number;
    averageComposite: number;
    documentCount: number;
  }> {
    let query = `
      SELECT AVG(qm.accuracy_score) as avg_accuracy,
             AVG(qm.completeness_score) as avg_completeness,
             AVG(qm.compliance_risk_score) as avg_compliance_risk,
             AVG(qm.composite_quality_score) as avg_composite,
             COUNT(*) as doc_count
      FROM quality_metrics qm
      JOIN documents d ON d.id = qm.document_id
      WHERE d.tenant_id = $1
    `;
    const params: unknown[] = [tenantId];

    if (startDate) {
      query += ` AND qm.calculated_at >= $${params.length + 1}`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND qm.calculated_at <= $${params.length + 1}`;
      params.push(endDate);
    }

    const result = await db.query<{
      avg_accuracy: number | null;
      avg_completeness: number | null;
      avg_compliance_risk: number | null;
      avg_composite: number | null;
      doc_count: string;
    }>(query, params);

    const row = result.rows[0];

    return {
      averageAccuracy: parseFloat(row.avg_accuracy?.toString() || '0'),
      averageCompleteness: parseFloat(row.avg_completeness?.toString() || '0'),
      averageComplianceRisk: parseFloat(row.avg_compliance_risk?.toString() || '0'),
      averageComposite: parseFloat(row.avg_composite?.toString() || '0'),
      documentCount: parseInt(row.doc_count, 10),
    };
  }
}

export const qualityMetricsService = new QualityMetricsService();
