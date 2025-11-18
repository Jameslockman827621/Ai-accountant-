import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { reconciliationExceptionService, ExceptionType, ExceptionSeverity } from './reconciliationExceptions';

const logger = createLogger('anomaly-detection');

export interface AnomalyResult {
  type: 'unusual_spend' | 'duplicate' | 'missing_document' | 'pattern_anomaly';
  severity: 'low' | 'medium' | 'high' | 'critical';
  score: number; // 0-1 anomaly score
  description: string;
  transactionId?: string;
  documentId?: string;
  ledgerEntryId?: string;
  suggestedActions: string[];
}

export class AnomalyDetectionService {
  /**
   * Detect anomalies for tenant
   */
  async detectAnomalies(
    tenantId: TenantId,
    options?: {
      startDate?: Date;
      endDate?: Date;
      minScore?: number;
    }
  ): Promise<AnomalyResult[]> {
    const anomalies: AnomalyResult[] = [];

    // Detect unusual spend
    const unusualSpend = await this.detectUnusualSpend(tenantId, options);
    anomalies.push(...unusualSpend);

    // Detect duplicates
    const duplicates = await this.detectDuplicates(tenantId, options);
    anomalies.push(...duplicates);

    // Detect missing documents
    const missingDocs = await this.detectMissingDocuments(tenantId, options);
    anomalies.push(...missingDocs);

    // Detect pattern anomalies
    const patternAnomalies = await this.detectPatternAnomalies(tenantId, options);
    anomalies.push(...patternAnomalies);

    // Filter by minimum score
    const minScore = options?.minScore || 0.5;
    return anomalies.filter((a) => a.score >= minScore);
  }

  /**
   * Detect unusual spend patterns
   */
  private async detectUnusualSpend(
    tenantId: TenantId,
    options?: { startDate?: Date; endDate?: Date }
  ): Promise<AnomalyResult[]> {
    const anomalies: AnomalyResult[] = [];

    // Get average transaction amount by category
    const avgResult = await db.query<{
      category: string;
      avg_amount: number;
      stddev_amount: number;
    }>(
      `SELECT
         COALESCE(category, 'uncategorized') as category,
         AVG(ABS(amount)) as avg_amount,
         STDDEV(ABS(amount)) as stddev_amount
       FROM bank_transactions
       WHERE tenant_id = $1
         AND date >= $2
         AND date <= $3
       GROUP BY category`,
      [
        tenantId,
        options?.startDate || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        options?.endDate || new Date(),
      ]
    );

    // Find transactions that are >2 standard deviations above mean
    for (const category of avgResult.rows) {
      const threshold = parseFloat(category.avg_amount.toString()) + 2 * parseFloat(category.stddev_amount.toString() || '0');

      const outliersResult = await db.query<{
        id: string;
        amount: number;
        date: Date;
        description: string;
      }>(
        `SELECT id, amount, date, description
         FROM bank_transactions
         WHERE tenant_id = $1
           AND COALESCE(category, 'uncategorized') = $2
           AND ABS(amount) > $3
           AND date >= $4
           AND date <= $5
           AND reconciled = false`,
        [
          tenantId,
          category.category,
          threshold,
          options?.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          options?.endDate || new Date(),
        ]
      );

      for (const outlier of outliersResult.rows) {
        const amount = parseFloat(outlier.amount.toString());
        const zScore = (amount - parseFloat(category.avg_amount.toString())) / parseFloat(category.stddev_amount.toString() || '1');
        const score = Math.min(1, Math.max(0, (zScore - 2) / 3)); // Normalize to 0-1

        anomalies.push({
          type: 'unusual_spend',
          severity: score > 0.8 ? 'critical' : score > 0.6 ? 'high' : 'medium',
          score,
          description: `Unusual spend: £${amount.toFixed(2)} in ${category.category} (${zScore.toFixed(1)}σ above average)`,
          transactionId: outlier.id,
          suggestedActions: [
            'Verify transaction authorization',
            'Check if transaction is legitimate',
            'Review budget for this category',
          ],
        });
      }
    }

    return anomalies;
  }

  /**
   * Detect duplicate transactions
   */
  private async detectDuplicates(
    tenantId: TenantId,
    options?: { startDate?: Date; endDate?: Date }
  ): Promise<AnomalyResult[]> {
    const anomalies: AnomalyResult[] = [];

    // Find transactions with same amount and date
    const duplicatesResult = await db.query<{
      amount: number;
      date: Date;
      count: string;
      transaction_ids: string[];
    }>(
      `SELECT
         amount,
         date,
         COUNT(*) as count,
         ARRAY_AGG(id) as transaction_ids
       FROM bank_transactions
       WHERE tenant_id = $1
         AND date >= $2
         AND date <= $3
         AND reconciled = false
       GROUP BY amount, date
       HAVING COUNT(*) > 1`,
      [
        tenantId,
        options?.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        options?.endDate || new Date(),
      ]
    );

    for (const dup of duplicatesResult.rows) {
      const count = parseInt(dup.count, 10);
      const score = Math.min(1, count / 3); // Higher score for more duplicates
      const firstTransactionId = dup.transaction_ids?.[0];

      const anomaly: {
        type: 'duplicate';
        severity: 'medium' | 'high';
        score: number;
        description: string;
        transactionId?: string;
        suggestedActions: string[];
      } = {
        type: 'duplicate',
        severity: count >= 3 ? 'high' : 'medium',
        score,
        description: `${count} duplicate transactions: £${parseFloat(dup.amount.toString()).toFixed(2)} on ${dup.date.toISOString().split('T')[0]}`,
        suggestedActions: [
          'Review transactions to identify duplicates',
          'Verify if transactions are legitimate',
          'Remove or void duplicate entries',
        ],
      };

      if (firstTransactionId) {
        anomaly.transactionId = firstTransactionId;
      }

      anomalies.push(anomaly);
    }

    return anomalies;
  }

  /**
   * Detect missing documents
   */
  private async detectMissingDocuments(
    tenantId: TenantId,
    options?: { startDate?: Date; endDate?: Date }
  ): Promise<AnomalyResult[]> {
    const anomalies: AnomalyResult[] = [];

    // Find transactions without documents
    const missingResult = await db.query<{
      id: string;
      amount: number;
      date: Date;
      description: string;
      days_old: number;
    }>(
      `SELECT
         bt.id,
         bt.amount,
         bt.date,
         bt.description,
         EXTRACT(DAY FROM NOW() - bt.date) as days_old
       FROM bank_transactions bt
       WHERE bt.tenant_id = $1
         AND bt.date >= $2
         AND bt.date <= $3
         AND bt.reconciled = false
         AND bt.reconciled_with_document IS NULL
         AND bt.amount > 10
       ORDER BY bt.date DESC`,
      [
        tenantId,
        options?.startDate || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        options?.endDate || new Date(),
      ]
    );

    for (const tx of missingResult.rows) {
      const daysOld = parseFloat(tx.days_old.toString());
      const score = Math.min(1, daysOld / 30); // Higher score for older transactions

      if (daysOld > 7) {
        anomalies.push({
          type: 'missing_document',
          severity: daysOld > 30 ? 'high' : daysOld > 14 ? 'medium' : 'low',
          score,
          description: `Missing document for transaction: £${parseFloat(tx.amount.toString()).toFixed(2)} from ${Math.floor(daysOld)} days ago`,
          transactionId: tx.id,
          suggestedActions: [
            'Request receipt or invoice from vendor',
            'Check if document was uploaded but not matched',
            'Add note explaining missing document',
          ],
        });
      }
    }

    return anomalies;
  }

  /**
   * Detect pattern anomalies
   */
  private async detectPatternAnomalies(
    tenantId: TenantId,
    options?: { startDate?: Date; endDate?: Date }
  ): Promise<AnomalyResult[]> {
    const anomalies: AnomalyResult[] = [];

    // Detect transactions on weekends (unusual for business)
    const weekendResult = await db.query<{
      id: string;
      amount: number;
      date: Date;
      description: string;
    }>(
      `SELECT id, amount, date, description
       FROM bank_transactions
       WHERE tenant_id = $1
         AND date >= $2
         AND date <= $3
         AND EXTRACT(DOW FROM date) IN (0, 6) -- Saturday, Sunday
         AND ABS(amount) > 100
         AND reconciled = false`,
      [
        tenantId,
        options?.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        options?.endDate || new Date(),
      ]
    );

    for (const tx of weekendResult.rows) {
      anomalies.push({
        type: 'pattern_anomaly',
        severity: 'medium',
        score: 0.6,
        description: `Weekend transaction: £${parseFloat(tx.amount.toString()).toFixed(2)} on ${tx.date.toISOString().split('T')[0]}`,
        transactionId: tx.id,
        suggestedActions: [
          'Verify if weekend transaction is expected',
          'Check if transaction date is correct',
          'Review transaction authorization',
        ],
      });
    }

    return anomalies;
  }

  /**
   * Process anomalies and create exceptions
   */
  async processAnomalies(tenantId: TenantId, anomalies: AnomalyResult[]): Promise<number> {
    let createdCount = 0;

    for (const anomaly of anomalies) {
      try {
        const exceptionType: ExceptionType = anomaly.type === 'pattern_anomaly' ? 'anomaly' : (anomaly.type as ExceptionType);
        const exceptionPayload: {
          exceptionType: ExceptionType;
          severity?: ExceptionSeverity;
          bankTransactionId?: string;
          documentId?: string;
          ledgerEntryId?: string;
          description: string;
          anomalyScore?: number;
          remediationPlaybook?: Array<{ step: number; action: string; description: string }>;
        } = {
          exceptionType,
          severity: anomaly.severity as ExceptionSeverity,
          description: anomaly.description,
        };

        if (anomaly.transactionId) {
          exceptionPayload.bankTransactionId = anomaly.transactionId;
        }
        if (anomaly.documentId) {
          exceptionPayload.documentId = anomaly.documentId;
        }
        if (anomaly.ledgerEntryId) {
          exceptionPayload.ledgerEntryId = anomaly.ledgerEntryId;
        }
        if (anomaly.score !== undefined) {
          exceptionPayload.anomalyScore = anomaly.score;
        }
        if (anomaly.suggestedActions.length > 0) {
          exceptionPayload.remediationPlaybook = anomaly.suggestedActions.map((action, index) => ({
            step: index + 1,
            action: action.toLowerCase().replace(/\s+/g, '_'),
            description: action,
          }));
        }

        await reconciliationExceptionService.createException(tenantId, exceptionPayload);
        createdCount++;
      } catch (error) {
        logger.error('Failed to create exception from anomaly', {
          anomaly,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    logger.info('Anomalies processed', { tenantId, totalAnomalies: anomalies.length, createdCount });

    return createdCount;
  }
}

export const anomalyDetectionService = new AnomalyDetectionService();
