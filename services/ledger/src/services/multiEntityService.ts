import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('multi-entity-service');

export interface Entity {
  id: string;
  tenantId: TenantId;
  parentEntityId?: string;
  entityName: string;
  entityType: 'parent' | 'subsidiary' | 'division' | 'department';
  currency: string;
  countryCode?: string;
  taxId?: string;
  isActive: boolean;
  metadata: Record<string, unknown>;
}

export interface IntercompanyTransaction {
  id: string;
  tenantId: TenantId;
  fromEntityId: string;
  toEntityId: string;
  transactionDate: Date;
  amount: number;
  currency: string;
  description: string;
  ledgerEntryId?: string;
  eliminated: boolean;
}

export class MultiEntityService {
  /**
   * Create entity
   */
  async createEntity(
    tenantId: TenantId,
    entity: {
      parentEntityId?: string;
      entityName: string;
      entityType: Entity['entityType'];
      currency?: string;
      countryCode?: string;
      taxId?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<string> {
    const entityId = randomUUID();

    await db.query(
      `INSERT INTO entities (
        id, tenant_id, parent_entity_id, entity_name, entity_type,
        currency, country_code, tax_id, is_active, metadata, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW(), NOW())`,
      [
        entityId,
        tenantId,
        entity.parentEntityId || null,
        entity.entityName,
        entity.entityType,
        entity.currency || 'GBP',
        entity.countryCode || null,
        entity.taxId || null,
        true,
        JSON.stringify(entity.metadata || {}),
      ]
    );

    logger.info('Entity created', { entityId, tenantId, entityName: entity.entityName });

    return entityId;
  }

  /**
   * Get entity hierarchy
   */
  async getEntityHierarchy(tenantId: TenantId): Promise<Entity[]> {
    const result = await db.query<{
      id: string;
      tenant_id: string;
      parent_entity_id: string | null;
      entity_name: string;
      entity_type: string;
      currency: string;
      country_code: string | null;
      tax_id: string | null;
      is_active: boolean;
      metadata: unknown;
    }>(
      `SELECT id, tenant_id, parent_entity_id, entity_name, entity_type,
              currency, country_code, tax_id, is_active, metadata
       FROM entities
       WHERE tenant_id = $1 AND is_active = true
       ORDER BY entity_type, entity_name`,
      [tenantId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id as TenantId,
      parentEntityId: row.parent_entity_id || undefined,
      entityName: row.entity_name,
      entityType: row.entity_type as Entity['entityType'],
      currency: row.currency,
      countryCode: row.country_code || undefined,
      taxId: row.tax_id || undefined,
      isActive: row.is_active,
      metadata: (row.metadata as Record<string, unknown>) || {},
    }));
  }

  /**
   * Create intercompany transaction
   */
  async createIntercompanyTransaction(
    tenantId: TenantId,
    transaction: {
      fromEntityId: string;
      toEntityId: string;
      transactionDate: Date;
      amount: number;
      currency: string;
      description: string;
      ledgerEntryId?: string;
    }
  ): Promise<string> {
    const transactionId = randomUUID();

    await db.query(
      `INSERT INTO intercompany_transactions (
        id, tenant_id, from_entity_id, to_entity_id, transaction_date,
        amount, currency, description, ledger_entry_id, eliminated, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
      [
        transactionId,
        tenantId,
        transaction.fromEntityId,
        transaction.toEntityId,
        transaction.transactionDate,
        transaction.amount,
        transaction.currency,
        transaction.description,
        transaction.ledgerEntryId || null,
        false,
      ]
    );

    logger.info('Intercompany transaction created', {
      transactionId,
      tenantId,
      fromEntityId: transaction.fromEntityId,
      toEntityId: transaction.toEntityId,
    });

    return transactionId;
  }

  /**
   * Eliminate intercompany transactions for consolidation
   */
  async eliminateIntercompanyTransactions(
    tenantId: TenantId,
    periodStart: Date,
    periodEnd: Date,
    entityIds: string[]
  ): Promise<{
    eliminatedCount: number;
    totalAmount: number;
  }> {
    const result = await db.query<{
      id: string;
      amount: number;
    }>(
      `SELECT id, amount
       FROM intercompany_transactions
       WHERE tenant_id = $1
         AND transaction_date BETWEEN $2 AND $3
         AND from_entity_id = ANY($4::uuid[])
         AND to_entity_id = ANY($4::uuid[])
         AND eliminated = false`,
      [tenantId, periodStart, periodEnd, entityIds]
    );

    let totalAmount = 0;
    for (const tx of result.rows) {
      await db.query(
        `UPDATE intercompany_transactions
         SET eliminated = true, eliminated_at = NOW()
         WHERE id = $1`,
        [tx.id]
      );
      totalAmount += parseFloat(tx.amount.toString());
    }

    logger.info('Intercompany transactions eliminated', {
      tenantId,
      eliminatedCount: result.rows.length,
      totalAmount,
    });

    return {
      eliminatedCount: result.rows.length,
      totalAmount,
    };
  }

  /**
   * Get consolidated P&L
   */
  async getConsolidatedProfitLoss(
    tenantId: TenantId,
    periodStart: Date,
    periodEnd: Date,
    entityIds: string[],
    baseCurrency: string
  ): Promise<{
    revenue: number;
    expenses: number;
    netIncome: number;
    exchangeRatesUsed: Record<string, number>;
    eliminationsApplied: Array<{ type: string; amount: number; description: string }>;
  }> {
    // Get exchange rates
    const exchangeRates = await this.getExchangeRates(tenantId, periodEnd, baseCurrency);

    // Get revenue and expenses for each entity
    let totalRevenue = 0;
    let totalExpenses = 0;

    for (const entityId of entityIds) {
      const entityResult = await db.query<{ currency: string }>(
        `SELECT currency FROM entities WHERE id = $1`,
        [entityId]
      );

      if (entityResult.rows.length === 0) continue;

      const entityCurrency = entityResult.rows[0].currency;
      const rate = exchangeRates[entityCurrency] || 1;

      // Get revenue (credit entries in revenue accounts - 4xxx)
      const revenueResult = await db.query<{ total: string }>(
        `SELECT SUM(amount) as total
         FROM ledger_entries
         WHERE tenant_id = $1
           AND account_code LIKE '4%'
           AND entry_type = 'credit'
           AND transaction_date BETWEEN $2 AND $3`,
        [tenantId, periodStart, periodEnd]
      );

      const revenue = parseFloat(revenueResult.rows[0]?.total || '0') * rate;
      totalRevenue += revenue;

      // Get expenses (debit entries in expense accounts - 5xxx, 6xxx)
      const expensesResult = await db.query<{ total: string }>(
        `SELECT SUM(amount) as total
         FROM ledger_entries
         WHERE tenant_id = $1
           AND account_code LIKE ANY(ARRAY['5%', '6%'])
           AND entry_type = 'debit'
           AND transaction_date BETWEEN $2 AND $3`,
        [tenantId, periodStart, periodEnd]
      );

      const expenses = parseFloat(expensesResult.rows[0]?.total || '0') * rate;
      totalExpenses += expenses;
    }

    // Eliminate intercompany transactions
    const eliminations = await this.eliminateIntercompanyTransactions(
      tenantId,
      periodStart,
      periodEnd,
      entityIds
    );

    const eliminationsApplied = [{
      type: 'intercompany',
      amount: eliminations.totalAmount,
      description: `Eliminated ${eliminations.eliminatedCount} intercompany transactions`,
    }];

    return {
      revenue: totalRevenue,
      expenses: totalExpenses,
      netIncome: totalRevenue - totalExpenses,
      exchangeRatesUsed: exchangeRates,
      eliminationsApplied,
    };
  }

  /**
   * Get consolidated balance sheet
   */
  async getConsolidatedBalanceSheet(
    tenantId: TenantId,
    asOfDate: Date,
    entityIds: string[],
    baseCurrency: string
  ): Promise<{
    assets: number;
    liabilities: number;
    equity: number;
    exchangeRatesUsed: Record<string, number>;
    eliminationsApplied: Array<{ type: string; amount: number; description: string }>;
  }> {
    const exchangeRates = await this.getExchangeRates(tenantId, asOfDate, baseCurrency);

    let totalAssets = 0;
    let totalLiabilities = 0;
    let totalEquity = 0;

    for (const entityId of entityIds) {
      const entityResult = await db.query<{ currency: string }>(
        `SELECT currency FROM entities WHERE id = $1`,
        [entityId]
      );

      if (entityResult.rows.length === 0) continue;

      const entityCurrency = entityResult.rows[0].currency;
      const rate = exchangeRates[entityCurrency] || 1;

      // Assets (1xxx accounts)
      const assetsResult = await db.query<{ balance: string }>(
        `SELECT
           SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE -amount END) as balance
         FROM ledger_entries
         WHERE tenant_id = $1
           AND account_code LIKE '1%'
           AND transaction_date <= $2`,
        [tenantId, asOfDate]
      );

      const assets = parseFloat(assetsResult.rows[0]?.balance || '0') * rate;
      totalAssets += assets;

      // Liabilities (2xxx accounts)
      const liabilitiesResult = await db.query<{ balance: string }>(
        `SELECT
           SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE -amount END) as balance
         FROM ledger_entries
         WHERE tenant_id = $1
           AND account_code LIKE '2%'
           AND transaction_date <= $2`,
        [tenantId, asOfDate]
      );

      const liabilities = parseFloat(liabilitiesResult.rows[0]?.balance || '0') * rate;
      totalLiabilities += liabilities;

      // Equity (3xxx accounts)
      const equityResult = await db.query<{ balance: string }>(
        `SELECT
           SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE -amount END) as balance
         FROM ledger_entries
         WHERE tenant_id = $1
           AND account_code LIKE '3%'
           AND transaction_date <= $2`,
        [tenantId, asOfDate]
      );

      const equity = parseFloat(equityResult.rows[0]?.balance || '0') * rate;
      totalEquity += equity;
    }

    return {
      assets: totalAssets,
      liabilities: totalLiabilities,
      equity: totalEquity,
      exchangeRatesUsed: exchangeRates,
      eliminationsApplied: [],
    };
  }

  /**
   * Get exchange rates for date
   */
  private async getExchangeRates(
    tenantId: TenantId,
    date: Date,
    baseCurrency: string
  ): Promise<Record<string, number>> {
    const result = await db.query<{
      from_currency: string;
      to_currency: string;
      rate: number;
    }>(
      `SELECT from_currency, to_currency, rate
       FROM exchange_rates
       WHERE tenant_id = $1
         AND rate_date = $2
         AND to_currency = $3
         AND rate_type = 'spot'
       ORDER BY rate_date DESC`,
      [tenantId, date, baseCurrency]
    );

    const rates: Record<string, number> = { [baseCurrency]: 1 };

    for (const row of result.rows) {
      rates[row.from_currency] = parseFloat(row.rate.toString());
    }

    return rates;
  }

  /**
   * Store exchange rate
   */
  async storeExchangeRate(
    tenantId: TenantId,
    fromCurrency: string,
    toCurrency: string,
    rateDate: Date,
    rate: number,
    rateType: 'spot' | 'average' | 'historical' = 'spot',
    source?: string
  ): Promise<string> {
    const rateId = randomUUID();

    await db.query(
      `INSERT INTO exchange_rates (
        id, tenant_id, from_currency, to_currency, rate_date,
        rate, rate_type, source, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (tenant_id, from_currency, to_currency, rate_date, rate_type) DO UPDATE SET
        rate = EXCLUDED.rate,
        source = EXCLUDED.source`,
      [rateId, tenantId, fromCurrency, toCurrency, rateDate, rate, rateType, source || null]
    );

    logger.info('Exchange rate stored', {
      rateId,
      tenantId,
      fromCurrency,
      toCurrency,
      rate,
      rateDate,
    });

    return rateId;
  }

  /**
   * Perform FX remeasurement
   */
  async performFXRemeasurement(
    tenantId: TenantId,
    entityId: string,
    periodStart: Date,
    periodEnd: Date,
    fromCurrency: string,
    toCurrency: string
  ): Promise<{
    remeasuredEntries: number;
    totalFXGainLoss: number;
  }> {
    // Get exchange rate
    const rateResult = await db.query<{ rate: number }>(
      `SELECT rate FROM exchange_rates
       WHERE tenant_id = $1
         AND from_currency = $2
         AND to_currency = $3
         AND rate_date = $4
         AND rate_type = 'spot'
       ORDER BY rate_date DESC
       LIMIT 1`,
      [tenantId, fromCurrency, toCurrency, periodEnd]
    );

    if (rateResult.rows.length === 0) {
      throw new Error(`Exchange rate not found: ${fromCurrency} to ${toCurrency} for ${periodEnd}`);
    }

    const rate = parseFloat(rateResult.rows[0].rate.toString());

    // Get ledger entries for entity in fromCurrency
    const entriesResult = await db.query<{
      id: string;
      account_code: string;
      amount: number;
      entry_type: string;
    }>(
      `SELECT id, account_code, amount, entry_type
       FROM ledger_entries
       WHERE tenant_id = $1
         AND transaction_date BETWEEN $2 AND $3
         AND currency = $4`,
      [tenantId, periodStart, periodEnd, fromCurrency]
    );

    let remeasuredCount = 0;
    let totalFXGainLoss = 0;

    for (const entry of entriesResult.rows) {
      const originalAmount = parseFloat(entry.amount.toString());
      const remeasuredAmount = originalAmount * rate;
      const fxGainLoss = remeasuredAmount - originalAmount;

      // Log remeasurement
      await db.query(
        `INSERT INTO fx_remeasurement_log (
          id, tenant_id, entity_id, period_start, period_end,
          from_currency, to_currency, remeasurement_date, account_code,
          original_amount, remeasured_amount, exchange_rate, fx_gain_loss, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())`,
        [
          randomUUID(),
          tenantId,
          entityId,
          periodStart,
          periodEnd,
          fromCurrency,
          toCurrency,
          periodEnd,
          entry.account_code,
          originalAmount,
          remeasuredAmount,
          rate,
          fxGainLoss,
        ]
      );

      remeasuredCount++;
      totalFXGainLoss += fxGainLoss;
    }

    logger.info('FX remeasurement completed', {
      tenantId,
      entityId,
      remeasuredCount,
      totalFXGainLoss,
    });

    return {
      remeasuredEntries: remeasuredCount,
      totalFXGainLoss,
    };
  }

  /**
   * Store consolidated report
   */
  async storeConsolidatedReport(
    tenantId: TenantId,
    report: {
      reportType: 'profit_loss' | 'balance_sheet' | 'cash_flow' | 'trial_balance';
      periodStart: Date;
      periodEnd: Date;
      entityIds: string[];
      baseCurrency: string;
      reportData: Record<string, unknown>;
      exchangeRatesUsed: Record<string, number>;
      eliminationsApplied: Array<{ type: string; amount: number; description: string }>;
      generatedBy?: UserId;
    }
  ): Promise<string> {
    const reportId = randomUUID();

    await db.query(
      `INSERT INTO consolidated_reports (
        id, tenant_id, report_type, period_start, period_end, entity_ids,
        base_currency, report_data, exchange_rates_used, eliminations_applied,
        generated_at, generated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, NOW(), $11)
      ON CONFLICT (tenant_id, report_type, period_start, period_end, entity_ids) DO UPDATE SET
        report_data = EXCLUDED.report_data,
        exchange_rates_used = EXCLUDED.exchange_rates_used,
        eliminations_applied = EXCLUDED.eliminations_applied,
        generated_at = NOW(),
        generated_by = EXCLUDED.generated_by`,
      [
        reportId,
        tenantId,
        report.reportType,
        report.periodStart,
        report.periodEnd,
        report.entityIds,
        report.baseCurrency,
        JSON.stringify(report.reportData),
        JSON.stringify(report.exchangeRatesUsed),
        JSON.stringify(report.eliminationsApplied),
        report.generatedBy || null,
      ]
    );

    logger.info('Consolidated report stored', {
      reportId,
      tenantId,
      reportType: report.reportType,
    });

    return reportId;
  }
}

export const multiEntityService = new MultiEntityService();
