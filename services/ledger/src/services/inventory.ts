import { TenantId } from '@ai-accountant/shared-types';

export type InventoryItem = {
  id: string;
  tenantId: TenantId;
  sku: string;
  description: string;
  onHand: number;
  reorderPoint: number;
  committed: number;
};

const inventory: InventoryItem[] = [];

export function upsertInventoryItem(item: InventoryItem): InventoryItem {
  const existingIndex = inventory.findIndex(row => row.tenantId === item.tenantId && row.sku === item.sku);
  if (existingIndex >= 0) {
    inventory[existingIndex] = { ...inventory[existingIndex], ...item };
    return inventory[existingIndex];
  }
  inventory.push(item);
  return item;
}

export function listInventory(tenantId: TenantId): InventoryItem[] {
  return inventory.filter(item => item.tenantId === tenantId);
}

export function reserveInventory(tenantId: TenantId, sku: string, quantity: number): InventoryItem | undefined {
  const item = inventory.find(row => row.tenantId === tenantId && row.sku === sku);
  if (!item) {
    return undefined;
  }
  item.committed += quantity;
  item.onHand = Math.max(item.onHand - quantity, 0);
  return item;
}
