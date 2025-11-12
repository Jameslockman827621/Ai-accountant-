import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('rules-engine-service');

export interface PAYECalculationResult {
  period: { start: Date; end: Date };
  grossPay: number;
  employeeNI: number;
  employerNI: number;
  incomeTax: number;
  studentLoan: number;
  pensionContributions: number;
  netPay: number;
  totalCost: number; // grossPay + employerNI
  breakdown: Array<{
    employeeId: string;
    name: string;
    grossPay: number;
    deductions: {
      incomeTax: number;
      employeeNI: number;
      studentLoan: number;
      pension: number;
    };
    netPay: number;
  }>;
}

// UK Tax Bands 2024-25
const TAX_BANDS = {
  personalAllowance: 12570, // Tax-free allowance
  basicRate: { threshold: 50270, rate: 0.20 }, // 20% up to £50,270
  higherRate: { threshold: 125140, rate: 0.40 }, // 40% up to £125,140
  additionalRate: { rate: 0.45 }, // 45% above £125,140
};

// National Insurance thresholds 2024-25
const NI_THRESHOLDS = {
  primaryThreshold: 12570, // Employee NI starts
  upperEarningsLimit: 50270, // Employee NI rate changes
  secondaryThreshold: 9100, // Employer NI starts
  employeeRate: { below: 0.12, above: 0.02 }, // 12% up to UEL, 2% above
  employerRate: 0.138, // 13.8% employer NI
};

export async function calculatePAYE(
  tenantId: TenantId,
  periodStart: Date,
  periodEnd: Date
): Promise<PAYECalculationResult> {
  logger.info('Calculating PAYE', { tenantId, periodStart, periodEnd });

  // Get payroll entries from ledger (simplified - in production, use dedicated payroll table)
  const payrollEntries = await db.query<{
    id: string;
    description: string;
    amount: number;
    transaction_date: Date;
    metadata: Record<string, unknown> | null;
  }>(
    `SELECT id, description, amount, transaction_date, metadata
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date >= $2
       AND transaction_date <= $3
       AND account_code LIKE '7%'
       AND description ILIKE '%salary%' OR description ILIKE '%wage%'
     ORDER BY transaction_date`,
    [tenantId, periodStart, periodEnd]
  );

  let totalGrossPay = 0;
  let totalEmployeeNI = 0;
  let totalEmployerNI = 0;
  let totalIncomeTax = 0;
  let totalStudentLoan = 0;
  let totalPension = 0;

  const breakdown: Array<{
    employeeId: string;
    name: string;
    grossPay: number;
    deductions: {
      incomeTax: number;
      employeeNI: number;
      studentLoan: number;
      pension: number;
    };
    netPay: number;
  }> = [];

  for (const entry of payrollEntries.rows) {
    const grossPay = entry.amount;
    totalGrossPay += grossPay;

    // Extract employee info from metadata or description
    const metadata = entry.metadata || {};
    const employeeId = (metadata.employeeId as string) || entry.id;
    const employeeName = (metadata.employeeName as string) || entry.description;

    // Calculate Income Tax
    const incomeTax = calculateIncomeTax(grossPay);
    totalIncomeTax += incomeTax;

    // Calculate Employee NI
    const employeeNI = calculateEmployeeNI(grossPay);
    totalEmployeeNI += employeeNI;

    // Calculate Employer NI
    const employerNI = calculateEmployerNI(grossPay);
    totalEmployerNI += employerNI;

    // Student Loan (simplified - assume Plan 2, 9% above £27,295)
    const studentLoanThreshold = 27295;
    const studentLoan = grossPay > studentLoanThreshold 
      ? (grossPay - studentLoanThreshold) * 0.09 
      : 0;
    totalStudentLoan += studentLoan;

    // Pension contributions (simplified - assume 5% employee, 3% employer)
    const pensionEmployee = grossPay * 0.05;
    const pensionEmployer = grossPay * 0.03;
    totalPension += pensionEmployee;

    const netPay = grossPay - incomeTax - employeeNI - studentLoan - pensionEmployee;

    breakdown.push({
      employeeId,
      name: employeeName,
      grossPay: Math.round(grossPay * 100) / 100,
      deductions: {
        incomeTax: Math.round(incomeTax * 100) / 100,
        employeeNI: Math.round(employeeNI * 100) / 100,
        studentLoan: Math.round(studentLoan * 100) / 100,
        pension: Math.round(pensionEmployee * 100) / 100,
      },
      netPay: Math.round(netPay * 100) / 100,
    });
  }

  const totalCost = totalGrossPay + totalEmployerNI;

  logger.info('PAYE calculation completed', {
    tenantId,
    totalGrossPay,
    totalCost,
    totalIncomeTax,
    totalEmployeeNI,
    totalEmployerNI,
  });

  return {
    period: { start: periodStart, end: periodEnd },
    grossPay: Math.round(totalGrossPay * 100) / 100,
    employeeNI: Math.round(totalEmployeeNI * 100) / 100,
    employerNI: Math.round(totalEmployerNI * 100) / 100,
    incomeTax: Math.round(totalIncomeTax * 100) / 100,
    studentLoan: Math.round(totalStudentLoan * 100) / 100,
    pensionContributions: Math.round(totalPension * 100) / 100,
    netPay: Math.round((totalGrossPay - totalIncomeTax - totalEmployeeNI - totalStudentLoan - totalPension) * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    breakdown,
  };
}

function calculateIncomeTax(grossPay: number): number {
  const taxableIncome = Math.max(0, grossPay - TAX_BANDS.personalAllowance);
  
  if (taxableIncome <= 0) {
    return 0;
  }

  let tax = 0;

  // Basic rate (20%)
  const basicRateIncome = Math.min(taxableIncome, TAX_BANDS.basicRate.threshold - TAX_BANDS.personalAllowance);
  tax += basicRateIncome * TAX_BANDS.basicRate.rate;

  // Higher rate (40%)
  if (taxableIncome > TAX_BANDS.basicRate.threshold - TAX_BANDS.personalAllowance) {
    const higherRateIncome = Math.min(
      taxableIncome - (TAX_BANDS.basicRate.threshold - TAX_BANDS.personalAllowance),
      TAX_BANDS.higherRate.threshold - TAX_BANDS.basicRate.threshold
    );
    tax += higherRateIncome * TAX_BANDS.higherRate.rate;
  }

  // Additional rate (45%)
  if (taxableIncome > TAX_BANDS.higherRate.threshold - TAX_BANDS.personalAllowance) {
    const additionalRateIncome = taxableIncome - (TAX_BANDS.higherRate.threshold - TAX_BANDS.personalAllowance);
    tax += additionalRateIncome * TAX_BANDS.additionalRate.rate;
  }

  return tax;
}

function calculateEmployeeNI(grossPay: number): number {
  const taxableIncome = Math.max(0, grossPay - NI_THRESHOLDS.primaryThreshold);
  
  if (taxableIncome <= 0) {
    return 0;
  }

  let ni = 0;

  // 12% up to upper earnings limit
  const belowUEL = Math.min(taxableIncome, NI_THRESHOLDS.upperEarningsLimit - NI_THRESHOLDS.primaryThreshold);
  ni += belowUEL * NI_THRESHOLDS.employeeRate.below;

  // 2% above upper earnings limit
  if (taxableIncome > NI_THRESHOLDS.upperEarningsLimit - NI_THRESHOLDS.primaryThreshold) {
    const aboveUEL = taxableIncome - (NI_THRESHOLDS.upperEarningsLimit - NI_THRESHOLDS.primaryThreshold);
    ni += aboveUEL * NI_THRESHOLDS.employeeRate.above;
  }

  return ni;
}

function calculateEmployerNI(grossPay: number): number {
  const taxableIncome = Math.max(0, grossPay - NI_THRESHOLDS.secondaryThreshold);
  
  if (taxableIncome <= 0) {
    return 0;
  }

  return taxableIncome * NI_THRESHOLDS.employerRate;
}
