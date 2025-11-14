import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('filing-service');

export interface PAYEFiling {
  periodStart: Date;
  periodEnd: Date;
  grossPay: number;
  employeeNIC: number;
  employerNIC: number;
  incomeTax: number;
  studentLoan: number;
  totalDeductions: number;
  netPay: number;
  totalPAYE: number;
}

export async function generatePAYEFiling(
  tenantId: TenantId,
  periodStart: Date,
  periodEnd: Date
): Promise<PAYEFiling> {
  logger.info('Generating PAYE filing', { tenantId, periodStart, periodEnd });

  // Get payroll transactions for the period
  const payrollResult = await db.query<{
    amount: number;
    description: string;
    entry_type: string;
  }>(
    `SELECT amount, description, entry_type
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date BETWEEN $2 AND $3
       AND (description ILIKE '%salary%' OR description ILIKE '%wage%' OR description ILIKE '%payroll%')
     ORDER BY transaction_date`,
    [tenantId, periodStart, periodEnd]
  );

  let grossPay = 0;
  let employeeNIC = 0;
  let employerNIC = 0;
  let incomeTax = 0;
  let studentLoan = 0;

  // Calculate PAYE from payroll entries
  for (const entry of payrollResult.rows) {
    if (entry.entry_type === 'debit' && entry.description.toLowerCase().includes('salary')) {
      grossPay += Math.abs(entry.amount);
      
      // Calculate deductions (simplified - in production use actual tax tables)
      const annualSalary = Math.abs(entry.amount) * 12; // Approximate annual
      
      // Income Tax (simplified calculation)
      const personalAllowance = 12570; // 2023/24 UK personal allowance
      const taxableIncome = Math.max(0, annualSalary - personalAllowance);
      
      if (taxableIncome > 0) {
        const basicRate = Math.min(taxableIncome, 37700) * 0.20;
        const higherRate = Math.max(0, taxableIncome - 37700) * 0.40;
        incomeTax += (basicRate + higherRate) / 12; // Monthly
      }
      
      // Employee NIC (simplified)
      const nicThreshold = 1048; // Monthly threshold
      const nicableIncome = Math.max(0, Math.abs(entry.amount) - nicThreshold);
      employeeNIC += nicableIncome * 0.12; // 12% rate
      
      // Employer NIC (simplified)
      employerNIC += nicableIncome * 0.138; // 13.8% rate
    }
  }

  const totalDeductions = employeeNIC + incomeTax + studentLoan;
  const netPay = grossPay - totalDeductions;
  const totalPAYE = incomeTax + employeeNIC + employerNIC;

  return {
    periodStart,
    periodEnd,
    grossPay: Math.round(grossPay * 100) / 100,
    employeeNIC: Math.round(employeeNIC * 100) / 100,
    employerNIC: Math.round(employerNIC * 100) / 100,
    incomeTax: Math.round(incomeTax * 100) / 100,
    studentLoan: Math.round(studentLoan * 100) / 100,
    totalDeductions: Math.round(totalDeductions * 100) / 100,
    netPay: Math.round(netPay * 100) / 100,
    totalPAYE: Math.round(totalPAYE * 100) / 100,
  };
}
