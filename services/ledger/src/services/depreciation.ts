import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { postDoubleEntry } from './posting';

const logger = createLogger('ledger-service');

export type DepreciationMethod = 'straight_line' | 'reducing_balance' | 'units_of_production';

export interface FixedAsset {
  id: string;
  tenantId: TenantId;
  description: string;
  accountCode: string;
  purchaseDate: Date;
  purchaseCost: number;
  residualValue: number;
  usefulLife: number; // years or units
  depreciationMethod: DepreciationMethod;
  depreciationRate?: number; // For reducing balance
}

export interface DepreciationEntry {
  assetId: string;
  period: Date;
  depreciationAmount: number;
  accumulatedDepreciation: number;
  netBookValue: number;
}

/**
 * Calculate depreciation for a period
 */
export async function calculateDepreciation(
  asset: FixedAsset,
  periodEnd: Date
): Promise<DepreciationEntry> {
  const monthsOwned = getMonthsBetween(asset.purchaseDate, periodEnd);
  const totalMonths = asset.usefulLife * 12;

  let depreciationAmount = 0;
  let accumulatedDepreciation = 0;

  switch (asset.depreciationMethod) {
    case 'straight_line':
      const annualDepreciation = (asset.purchaseCost - asset.residualValue) / asset.usefulLife;
      const monthlyDepreciation = annualDepreciation / 12;
      depreciationAmount = monthlyDepreciation;
      accumulatedDepreciation = monthlyDepreciation * monthsOwned;
      break;

    case 'reducing_balance':
      const rate = asset.depreciationRate || (1 - Math.pow(asset.residualValue / asset.purchaseCost, 1 / asset.usefulLife));
      let bookValue = asset.purchaseCost;
      for (let i = 0; i < monthsOwned; i++) {
        const monthlyDep = bookValue * (rate / 12);
        bookValue -= monthlyDep;
        if (i === monthsOwned - 1) {
          depreciationAmount = monthlyDep;
        }
      }
      accumulatedDepreciation = asset.purchaseCost - bookValue;
      break;

    case 'units_of_production':
      // Would need actual usage data
      const totalUnits = asset.usefulLife;
      const unitsPerMonth = totalUnits / (asset.usefulLife * 12);
      depreciationAmount = (asset.purchaseCost - asset.residualValue) / totalUnits * unitsPerMonth;
      accumulatedDepreciation = (asset.purchaseCost - asset.residualValue) / totalUnits * (unitsPerMonth * monthsOwned);
      break;
  }

  const netBookValue = asset.purchaseCost - accumulatedDepreciation;

  return {
    assetId: asset.id,
    period: periodEnd,
    depreciationAmount: Math.max(0, depreciationAmount),
    accumulatedDepreciation: Math.max(0, Math.min(accumulatedDepreciation, asset.purchaseCost - asset.residualValue)),
    netBookValue: Math.max(asset.residualValue, netBookValue),
  };
}

/**
 * Post depreciation journal entry
 */
export async function postDepreciation(
  tenantId: TenantId,
  asset: FixedAsset,
  periodEnd: Date,
  createdBy: UserId
): Promise<string> {
  const depreciation = await calculateDepreciation(asset, periodEnd);

  // Post: Debit Depreciation Expense, Credit Accumulated Depreciation
  const { transactionId } = await postDoubleEntry({
    tenantId,
    description: `Depreciation: ${asset.description}`,
    transactionDate: periodEnd,
    entries: [
      {
        entryType: 'debit',
        accountCode: '5500', // Depreciation Expense
        accountName: 'Depreciation Expense',
        amount: depreciation.depreciationAmount,
      },
      {
        entryType: 'credit',
        accountCode: '1500', // Accumulated Depreciation
        accountName: 'Accumulated Depreciation',
        amount: depreciation.depreciationAmount,
      },
    ],
    createdBy,
    metadata: {
      assetId: asset.id,
      period: periodEnd.toISOString(),
      method: asset.depreciationMethod,
    },
  });

  // Store depreciation record
  await db.query(
    `INSERT INTO depreciation_entries (
      id, tenant_id, asset_id, period, depreciation_amount, accumulated_depreciation, net_book_value, created_at
    ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW())`,
    [
      tenantId,
      asset.id,
      periodEnd,
      depreciation.depreciationAmount,
      depreciation.accumulatedDepreciation,
      depreciation.netBookValue,
    ]
  );

  logger.info('Depreciation posted', { assetId: asset.id, tenantId, amount: depreciation.depreciationAmount });
  return transactionId;
}

function getMonthsBetween(date1: Date, date2: Date): number {
  const years = date2.getFullYear() - date1.getFullYear();
  const months = date2.getMonth() - date1.getMonth();
  return years * 12 + months;
}

/**
 * Create fixed asset
 */
export async function createFixedAsset(
  tenantId: TenantId,
  asset: Omit<FixedAsset, 'id' | 'tenantId'>
): Promise<string> {
  const assetId = crypto.randomUUID();

  await db.query(
    `INSERT INTO fixed_assets (
      id, tenant_id, description, account_code, purchase_date, purchase_cost, residual_value,
      useful_life, depreciation_method, depreciation_rate, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
    [
      assetId,
      tenantId,
      asset.description,
      asset.accountCode,
      asset.purchaseDate,
      asset.purchaseCost,
      asset.residualValue,
      asset.usefulLife,
      asset.depreciationMethod,
      asset.depreciationRate || null,
    ]
  );

  logger.info('Fixed asset created', { assetId, tenantId });
  return assetId;
}
