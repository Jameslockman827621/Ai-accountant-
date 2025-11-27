import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

type DepreciationMethod = 'straight_line' | 'declining_balance';

type FixedAsset = {
  id: string;
  tenantId: TenantId;
  name: string;
  category: string;
  acquisitionDate: string;
  cost: number;
  usefulLifeMonths: number;
  salvageValue: number;
  method: DepreciationMethod;
};

type DepreciationScheduleEntry = {
  period: number;
  startDate: string;
  endDate: string;
  depreciationExpense: number;
  accumulatedDepreciation: number;
  netBookValue: number;
};

const logger = createLogger('fixed-assets');
const assetStore: FixedAsset[] = [];

function calculateStraightLine(asset: FixedAsset): DepreciationScheduleEntry[] {
  const monthlyDepreciableBase = (asset.cost - asset.salvageValue) / asset.usefulLifeMonths;
  const schedule: DepreciationScheduleEntry[] = [];
  let accumulatedDepreciation = 0;

  for (let month = 1; month <= asset.usefulLifeMonths; month += 1) {
    accumulatedDepreciation += monthlyDepreciableBase;
    schedule.push({
      period: month,
      startDate: new Date(new Date(asset.acquisitionDate).setMonth(new Date(asset.acquisitionDate).getMonth() + month - 1)).toISOString(),
      endDate: new Date(new Date(asset.acquisitionDate).setMonth(new Date(asset.acquisitionDate).getMonth() + month)).toISOString(),
      depreciationExpense: parseFloat(monthlyDepreciableBase.toFixed(2)),
      accumulatedDepreciation: parseFloat(accumulatedDepreciation.toFixed(2)),
      netBookValue: parseFloat((asset.cost - accumulatedDepreciation).toFixed(2)),
    });
  }
  return schedule;
}

export function addFixedAsset(asset: FixedAsset): FixedAsset {
  assetStore.push(asset);
  logger.info('Asset added to register', { assetId: asset.id, tenantId: asset.tenantId });
  return asset;
}

export function getFixedAssets(tenantId: TenantId): FixedAsset[] {
  return assetStore.filter(a => a.tenantId === tenantId);
}

export function getDepreciationSchedule(assetId: string): DepreciationScheduleEntry[] {
  const asset = assetStore.find(a => a.id === assetId);
  if (!asset) {
    throw new Error('Asset not found');
  }

  switch (asset.method) {
    case 'declining_balance': {
      const rate = 2 / asset.usefulLifeMonths;
      const schedule: DepreciationScheduleEntry[] = [];
      let remainingBook = asset.cost;
      let accumulatedDepreciation = 0;
      for (let period = 1; period <= asset.usefulLifeMonths; period += 1) {
        const depreciationExpense = Math.max(
          parseFloat((remainingBook * rate).toFixed(2)),
          asset.salvageValue
        );
        accumulatedDepreciation += depreciationExpense;
        remainingBook -= depreciationExpense;
        schedule.push({
          period,
          startDate: new Date(new Date(asset.acquisitionDate).setMonth(new Date(asset.acquisitionDate).getMonth() + period - 1)).toISOString(),
          endDate: new Date(new Date(asset.acquisitionDate).setMonth(new Date(asset.acquisitionDate).getMonth() + period)).toISOString(),
          depreciationExpense,
          accumulatedDepreciation: parseFloat(accumulatedDepreciation.toFixed(2)),
          netBookValue: parseFloat(remainingBook.toFixed(2)),
        });
      }
      return schedule;
    }
    case 'straight_line':
    default:
      return calculateStraightLine(asset);
  }
}
