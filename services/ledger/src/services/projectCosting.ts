import { TenantId } from '@ai-accountant/shared-types';

export type ProjectCost = {
  id: string;
  tenantId: TenantId;
  projectCode: string;
  description: string;
  laborHours: number;
  laborRate: number;
  materials: number;
  overheadRate: number;
};

export type ProjectCostingSummary = {
  projectCode: string;
  totalCost: number;
  breakdown: {
    labor: number;
    materials: number;
    overhead: number;
  };
};

const projectCosts: ProjectCost[] = [];

export function recordProjectCost(cost: ProjectCost): ProjectCost {
  projectCosts.push(cost);
  return cost;
}

export function getProjectCosts(tenantId: TenantId): ProjectCost[] {
  return projectCosts.filter(cost => cost.tenantId === tenantId);
}

export function summarizeProjectCosts(tenantId: TenantId, projectCode: string): ProjectCostingSummary {
  const rows = projectCosts.filter(cost => cost.tenantId === tenantId && cost.projectCode === projectCode);
  const labor = rows.reduce((sum, row) => sum + row.laborHours * row.laborRate, 0);
  const materials = rows.reduce((sum, row) => sum + row.materials, 0);
  const overhead = rows.reduce((sum, row) => sum + row.overheadRate * (row.laborHours * row.laborRate), 0);
  const totalCost = labor + materials + overhead;

  return {
    projectCode,
    totalCost,
    breakdown: { labor, materials, overhead },
  };
}
