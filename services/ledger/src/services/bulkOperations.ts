/**
 * Bulk Operations Service
 */

import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { TenantId, UserId } from '@ai-accountant/shared-types';

const logger = createLogger('bulk-operations');

export interface BulkOperation {
  id: string;
  tenantId: TenantId;
  type: 'document_processing' | 'categorization' | 'ledger_posting' | 'filing_creation';
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'partial';
  totalItems: number;
  processedItems: number;
  successfulItems: number;
  failedItems: number;
  errors: Array<{ itemId: string; error: string }>;
  createdBy: UserId;
  createdAt: Date;
  completedAt?: Date;
}

export interface BulkOperationResult {
  operationId: string;
  status: BulkOperation['status'];
  processed: number;
  successful: number;
  failed: number;
  errors: BulkOperation['errors'];
}

export class BulkOperationsService {
  async createBulkOperation(
    tenantId: TenantId,
    type: BulkOperation['type'],
    itemIds: string[],
    createdBy: UserId
  ): Promise<string> {
    const operationId = `bulk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    await db.query(
      `INSERT INTO bulk_operations (
        id, tenant_id, type, status, total_items, processed_items, successful_items,
        failed_items, created_by, created_at
      ) VALUES ($1, $2, $3, 'pending', $4, 0, 0, 0, $5, NOW())`,
      [operationId, tenantId, type, itemIds.length, createdBy]
    );

    // Store operation items
    for (const itemId of itemIds) {
      await db.query(
        `INSERT INTO bulk_operation_items (
          id, operation_id, item_id, status, created_at
        ) VALUES (gen_random_uuid(), $1, $2, 'pending', NOW())`,
        [operationId, itemId]
      );
    }

    logger.info('Bulk operation created', { operationId, type, itemCount: itemIds.length });
    return operationId;
  }

  async processBulkDocuments(
    tenantId: TenantId,
    documentIds: string[],
    createdBy: UserId
  ): Promise<BulkOperationResult> {
    const operationId = await this.createBulkOperation(
      tenantId,
      'document_processing',
      documentIds,
      createdBy
    );

    await this.updateOperationStatus(operationId, 'processing');

    let successful = 0;
    let failed = 0;
    const errors: Array<{ itemId: string; error: string }> = [];

    for (const documentId of documentIds) {
      try {
        // Trigger document processing
        await db.query(
          `UPDATE documents SET status = 'processing', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
          [documentId, tenantId]
        );

        // In production, queue document processing job
        await this.updateOperationItem(operationId, documentId, 'completed');
        successful++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({ itemId: documentId, error: errorMessage });
        await this.updateOperationItem(operationId, documentId, 'failed', errorMessage);
        failed++;
      }

      await this.incrementProcessed(operationId);
    }

    const status = failed === 0 ? 'completed' : failed === documentIds.length ? 'failed' : 'partial';
    await this.finalizeOperation(operationId, status, successful, failed);

    return {
      operationId,
      status,
      processed: documentIds.length,
      successful,
      failed,
      errors,
    };
  }

  async processBulkCategorization(
    tenantId: TenantId,
    transactionIds: string[],
    categoryId: string,
    createdBy: UserId
  ): Promise<BulkOperationResult> {
    const operationId = await this.createBulkOperation(
      tenantId,
      'categorization',
      transactionIds,
      createdBy
    );

    await this.updateOperationStatus(operationId, 'processing');

    let successful = 0;
    let failed = 0;
    const errors: Array<{ itemId: string; error: string }> = [];

    for (const transactionId of transactionIds) {
      try {
        await db.query(
          `UPDATE bank_transactions 
           SET category_id = $1, updated_at = NOW() 
           WHERE id = $2 AND tenant_id = $3`,
          [categoryId, transactionId, tenantId]
        );

        await this.updateOperationItem(operationId, transactionId, 'completed');
        successful++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({ itemId: transactionId, error: errorMessage });
        await this.updateOperationItem(operationId, transactionId, 'failed', errorMessage);
        failed++;
      }

      await this.incrementProcessed(operationId);
    }

    const status = failed === 0 ? 'completed' : failed === transactionIds.length ? 'failed' : 'partial';
    await this.finalizeOperation(operationId, status, successful, failed);

    return {
      operationId,
      status,
      processed: transactionIds.length,
      successful,
      failed,
      errors,
    };
  }

  async processBulkLedgerPosting(
    tenantId: TenantId,
    documentIds: string[],
    createdBy: UserId
  ): Promise<BulkOperationResult> {
    const operationId = await this.createBulkOperation(
      tenantId,
      'ledger_posting',
      documentIds,
      createdBy
    );

    await this.updateOperationStatus(operationId, 'processing');

    let successful = 0;
    let failed = 0;
    const errors: Array<{ itemId: string; error: string }> = [];

    for (const documentId of documentIds) {
      try {
        // Get document
        const doc = await db.query<{
          extracted_data: unknown;
          account_code: string;
        }>(
          `SELECT extracted_data, account_code FROM documents WHERE id = $1 AND tenant_id = $2`,
          [documentId, tenantId]
        );

        if (doc.rows.length === 0) {
          throw new Error('Document not found');
        }

        const extractedData = doc.rows[0].extracted_data as Record<string, unknown>;
        const amount = extractedData.total as number || 0;

        // Post to ledger
        await db.query(
          `INSERT INTO ledger_entries (
            id, tenant_id, account_code, amount, description, transaction_date, source_document_id, created_by, created_at
          ) VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), $5, $6, NOW())`,
          [
            tenantId,
            doc.rows[0].account_code || '6000',
            amount,
            `Bulk posting: ${documentId}`,
            documentId,
            createdBy,
          ]
        );

        await this.updateOperationItem(operationId, documentId, 'completed');
        successful++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({ itemId: documentId, error: errorMessage });
        await this.updateOperationItem(operationId, documentId, 'failed', errorMessage);
        failed++;
      }

      await this.incrementProcessed(operationId);
    }

    const status = failed === 0 ? 'completed' : failed === documentIds.length ? 'failed' : 'partial';
    await this.finalizeOperation(operationId, status, successful, failed);

    return {
      operationId,
      status,
      processed: documentIds.length,
      successful,
      failed,
      errors,
    };
  }

  async processBulkFilingCreation(
    tenantId: TenantId,
    periodIds: string[],
    createdBy: UserId
  ): Promise<BulkOperationResult> {
    const operationId = await this.createBulkOperation(
      tenantId,
      'filing_creation',
      periodIds,
      createdBy
    );

    await this.updateOperationStatus(operationId, 'processing');

    let successful = 0;
    let failed = 0;
    const errors: Array<{ itemId: string; error: string }> = [];

    for (const periodId of periodIds) {
      try {
        // Create filing for period
        const filingId = `filing_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        await db.query(
          `INSERT INTO filings (
            id, tenant_id, period_id, type, status, created_by, created_at
          ) VALUES ($1, $2, $3, 'vat', 'draft', $4, NOW())`,
          [filingId, tenantId, periodId, createdBy]
        );

        await this.updateOperationItem(operationId, periodId, 'completed');
        successful++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({ itemId: periodId, error: errorMessage });
        await this.updateOperationItem(operationId, periodId, 'failed', errorMessage);
        failed++;
      }

      await this.incrementProcessed(operationId);
    }

    const status = failed === 0 ? 'completed' : failed === periodIds.length ? 'failed' : 'partial';
    await this.finalizeOperation(operationId, status, successful, failed);

    return {
      operationId,
      status,
      processed: periodIds.length,
      successful,
      failed,
      errors,
    };
  }

  async getOperationStatus(operationId: string): Promise<BulkOperation | null> {
    const result = await db.query<BulkOperation>(
      `SELECT * FROM bulk_operations WHERE id = $1`,
      [operationId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const op = result.rows[0];
    
    // Get errors
    const errorsResult = await db.query<{ item_id: string; error_message: string }>(
      `SELECT item_id, error_message FROM bulk_operation_items
       WHERE operation_id = $1 AND status = 'failed'`,
      [operationId]
    );

    op.errors = errorsResult.rows.map(row => ({
      itemId: row.item_id,
      error: row.error_message || 'Unknown error',
    }));

    return op;
  }

  private async updateOperationStatus(
    operationId: string,
    status: BulkOperation['status']
  ): Promise<void> {
    await db.query(
      `UPDATE bulk_operations SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, operationId]
    );
  }

  private async updateOperationItem(
    operationId: string,
    itemId: string,
    status: 'pending' | 'completed' | 'failed',
    error?: string
  ): Promise<void> {
    await db.query(
      `UPDATE bulk_operation_items 
       SET status = $1, error_message = $2, updated_at = NOW() 
       WHERE operation_id = $3 AND item_id = $4`,
      [status, error || null, operationId, itemId]
    );
  }

  private async incrementProcessed(operationId: string): Promise<void> {
    await db.query(
      `UPDATE bulk_operations 
       SET processed_items = processed_items + 1, updated_at = NOW() 
       WHERE id = $1`,
      [operationId]
    );
  }

  private async finalizeOperation(
    operationId: string,
    status: BulkOperation['status'],
    successful: number,
    failed: number
  ): Promise<void> {
    await db.query(
      `UPDATE bulk_operations 
       SET status = $1, successful_items = $2, failed_items = $3, completed_at = NOW(), updated_at = NOW() 
       WHERE id = $4`,
      [status, successful, failed, operationId]
    );
  }
}

export const bulkOperationsService = new BulkOperationsService();
