import { TenantId } from '@ai-accountant/shared-types';
import {
  generateProfitAndLoss,
  generateBalanceSheet,
  generateCashFlow,
  ProfitAndLoss,
  BalanceSheet,
  CashFlow,
} from './financialReports';
import { ReportType } from '../types/reportTypes';

export type ReportUnionMap = {
  profit_loss: ProfitAndLoss;
  balance_sheet: BalanceSheet;
  cash_flow: CashFlow;
};

export async function loadReportData(
  tenantId: TenantId,
  reportType: ReportType,
  periodStart: Date,
  periodEnd: Date
): Promise<ReportUnionMap[ReportType]> {
  switch (reportType) {
    case 'profit_loss':
      return generateProfitAndLoss(tenantId, periodStart, periodEnd);
    case 'balance_sheet':
      return generateBalanceSheet(tenantId, periodEnd);
    case 'cash_flow':
      return generateCashFlow(tenantId, periodStart, periodEnd);
    default:
      throw new Error(`Unsupported report type: ${String(reportType)}`);
  }
}
