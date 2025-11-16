/**
 * Multi-Entity Consolidation
 */

import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';

const logger = createLogger('multi-entity-consolidation');

export interface Entity {
  id: string;
  name: string;
  type: 'parent' | 'subsidiary' | 'joint_venture';
  parentId?: string;
  ownershipPercentage?: number;
}

export interface ConsolidatedReport {
  entities: Entity[];
  consolidatedBalanceSheet: {
    assets: number;
    liabilities: number;
    equity: number;
  };
  consolidatedIncomeStatement: {
    revenue: number;
    expenses: number;
    profit: number;
  };
  intercompanyEliminations: {
    transactions: number;
    amount: number;
  };
  currencyAdjustments: {
    entities: Array<{
      entityId: string;
      currency: string;
      adjustment: number;
    }>;
  };
}

export class MultiEntityConsolidator {
  async consolidateEntities(
    parentEntityId: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<ConsolidatedReport> {
    // Get all entities in the group
    const entities = await this.getEntityGroup(parentEntityId);

    // Get financial data for each entity
    const entityData = await Promise.all(
      entities.map(entity => this.getEntityFinancialData(entity.id, periodStart, periodEnd))
    );

    // Consolidate balance sheets
    const consolidatedBalanceSheet = this.consolidateBalanceSheets(entities, entityData);

    // Consolidate income statements
    const consolidatedIncomeStatement = this.consolidateIncomeStatements(entities, entityData);

    // Eliminate intercompany transactions
    const eliminations = await this.eliminateIntercompanyTransactions(entities, periodStart, periodEnd);

    // Apply currency adjustments
    const currencyAdjustments = await this.applyCurrencyAdjustments(entities, entityData);

    return {
      entities,
      consolidatedBalanceSheet,
      consolidatedIncomeStatement,
      intercompanyEliminations: eliminations,
      currencyAdjustments,
    };
  }

  private async getEntityGroup(parentEntityId: string): Promise<Entity[]> {
    const result = await db.query<Entity>(
      `SELECT id, name, type, parent_id as "parentId", ownership_percentage as "ownershipPercentage"
       FROM entities
       WHERE id = $1 OR parent_id = $1
       ORDER BY type`,
      [parentEntityId]
    );

    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      type: row.type,
      parentId: row.parentId,
      ownershipPercentage: row.ownershipPercentage,
    }));
  }

  private async getEntityFinancialData(
    entityId: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<{
    balanceSheet: { assets: number; liabilities: number; equity: number };
    incomeStatement: { revenue: number; expenses: number; profit: number };
  }> {
    // Get balance sheet
    const balanceSheet = await db.query<{
      assets: string | number;
      liabilities: string | number;
      equity: string | number;
    }>(
      `SELECT 
        COALESCE(SUM(CASE WHEN account_type = 'asset' THEN amount ELSE 0 END), 0) as assets,
        COALESCE(SUM(CASE WHEN account_type = 'liability' THEN amount ELSE 0 END), 0) as liabilities,
        COALESCE(SUM(CASE WHEN account_type = 'equity' THEN amount ELSE 0 END), 0) as equity
       FROM ledger_entries
       WHERE tenant_id = $1
         AND transaction_date <= $2`,
      [entityId, periodEnd]
    );

    // Get income statement
    const incomeStatement = await db.query<{
      revenue: string | number;
      expenses: string | number;
    }>(
      `SELECT 
        COALESCE(SUM(CASE WHEN account_type = 'revenue' THEN amount ELSE 0 END), 0) as revenue,
        COALESCE(SUM(CASE WHEN account_type = 'expense' THEN amount ELSE 0 END), 0) as expenses
       FROM ledger_entries
       WHERE tenant_id = $1
         AND transaction_date BETWEEN $2 AND $3`,
      [entityId, periodStart, periodEnd]
    );

    const rev = typeof incomeStatement.rows[0]?.revenue === 'number'
      ? incomeStatement.rows[0].revenue
      : parseFloat(String(incomeStatement.rows[0]?.revenue || '0'));
    const exp = typeof incomeStatement.rows[0]?.expenses === 'number'
      ? incomeStatement.rows[0].expenses
      : parseFloat(String(incomeStatement.rows[0]?.expenses || '0'));

    return {
      balanceSheet: {
        assets: typeof balanceSheet.rows[0]?.assets === 'number'
          ? balanceSheet.rows[0].assets
          : parseFloat(String(balanceSheet.rows[0]?.assets || '0')),
        liabilities: typeof balanceSheet.rows[0]?.liabilities === 'number'
          ? balanceSheet.rows[0].liabilities
          : parseFloat(String(balanceSheet.rows[0]?.liabilities || '0')),
        equity: typeof balanceSheet.rows[0]?.equity === 'number'
          ? balanceSheet.rows[0].equity
          : parseFloat(String(balanceSheet.rows[0]?.equity || '0')),
      },
      incomeStatement: {
        revenue: rev,
        expenses: exp,
        profit: rev - exp,
      },
    };
  }

  private consolidateBalanceSheets(
    entities: Entity[],
    entityData: Array<{
      balanceSheet: { assets: number; liabilities: number; equity: number };
    }>
  ): ConsolidatedReport['consolidatedBalanceSheet'] {
    let totalAssets = 0;
    let totalLiabilities = 0;
    let totalEquity = 0;

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      const data = entityData[i];

      // Apply ownership percentage for subsidiaries
      const multiplier = entity.type === 'subsidiary' && entity.ownershipPercentage
        ? entity.ownershipPercentage / 100
        : 1;

      totalAssets += data.balanceSheet.assets * multiplier;
      totalLiabilities += data.balanceSheet.liabilities * multiplier;
      totalEquity += data.balanceSheet.equity * multiplier;
    }

    return {
      assets: totalAssets,
      liabilities: totalLiabilities,
      equity: totalEquity,
    };
  }

  private consolidateIncomeStatements(
    entities: Entity[],
    entityData: Array<{
      incomeStatement: { revenue: number; expenses: number; profit: number };
    }>
  ): ConsolidatedReport['consolidatedIncomeStatement'] {
    let totalRevenue = 0;
    let totalExpenses = 0;

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      const data = entityData[i];

      const multiplier = entity.type === 'subsidiary' && entity.ownershipPercentage
        ? entity.ownershipPercentage / 100
        : 1;

      totalRevenue += data.incomeStatement.revenue * multiplier;
      totalExpenses += data.incomeStatement.expenses * multiplier;
    }

    return {
      revenue: totalRevenue,
      expenses: totalExpenses,
      profit: totalRevenue - totalExpenses,
    };
  }

  private async eliminateIntercompanyTransactions(
    entities: Entity[],
    periodStart: Date,
    periodEnd: Date
  ): Promise<ConsolidatedReport['intercompanyEliminations']> {
    const entityIds = entities.map(e => e.id);
    
    const result = await db.query<{
      count: string | number;
      amount: string | number;
    }>(
      `SELECT 
        COUNT(*) as count,
        COALESCE(SUM(amount), 0) as amount
       FROM ledger_entries
       WHERE tenant_id = ANY($1)
         AND counterparty_entity_id = ANY($1)
         AND transaction_date BETWEEN $2 AND $3`,
      [entityIds, periodStart, periodEnd]
    );

    return {
      transactions: typeof result.rows[0]?.count === 'number'
        ? result.rows[0].count
        : parseInt(String(result.rows[0]?.count || '0'), 10),
      amount: typeof result.rows[0]?.amount === 'number'
        ? result.rows[0].amount
        : parseFloat(String(result.rows[0]?.amount || '0')),
    };
  }

  private async applyCurrencyAdjustments(
    entities: Entity[],
    entityData: unknown[]
  ): Promise<ConsolidatedReport['currencyAdjustments']> {
    // In production, fetch exchange rates and apply adjustments
    // For now, return empty adjustments
    return {
      entities: entities.map(entity => ({
        entityId: entity.id,
        currency: 'GBP', // Default
        adjustment: 0,
      })),
    };
  }
}

export const multiEntityConsolidator = new MultiEntityConsolidator();
