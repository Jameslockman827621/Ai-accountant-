import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('validation-service');

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  confidence: number;
}

export async function validateTaxCalculation(
  tenantId: TenantId,
  filingType: string,
  filingData: Record<string, unknown>
): Promise<ValidationResult> {
  logger.info('Validating tax calculation', { tenantId, filingType });

  const errors: string[] = [];
  const warnings: string[] = [];

  if (filingType === 'vat') {
    // Validate VAT calculation
    const vatDueSales = filingData.vatDueSales as number || 0;
    const vatDueAcquisitions = filingData.vatDueAcquisitions as number || 0;
    const totalVatDue = filingData.totalVatDue as number || 0;
    const vatReclaimed = filingData.vatReclaimedCurrPeriod as number || 0;
    const netVatDue = filingData.netVatDue as number || 0;

    // Check calculations
    const calculatedTotal = vatDueSales + vatDueAcquisitions;
    if (Math.abs(calculatedTotal - totalVatDue) > 0.01) {
      errors.push(`Total VAT due mismatch: calculated ${calculatedTotal}, provided ${totalVatDue}`);
    }

    const calculatedNet = totalVatDue - vatReclaimed;
    if (Math.abs(calculatedNet - netVatDue) > 0.01) {
      errors.push(`Net VAT due mismatch: calculated ${calculatedNet}, provided ${netVatDue}`);
    }

    // Check for negative values (should be positive)
    if (vatDueSales < 0) warnings.push('VAT due on sales is negative');
    if (vatDueAcquisitions < 0) warnings.push('VAT due on acquisitions is negative');
    if (vatReclaimed < 0) warnings.push('VAT reclaimed is negative');

    // Check for reasonable values
    const totalSales = filingData.totalValueSalesExVAT as number || 0;
    if (totalSales > 0 && vatDueSales / totalSales > 0.25) {
      warnings.push('VAT rate appears unusually high (>25%)');
    }
  } else if (filingType === 'paye') {
    // Validate PAYE calculation
    const grossPay = filingData.grossPay as number || 0;
    const employeeNIC = filingData.employeeNIC as number || 0;
    const employerNIC = filingData.employerNIC as number || 0;
    const incomeTax = filingData.incomeTax as number || 0;
    const totalDeductions = filingData.totalDeductions as number || 0;
    const netPay = filingData.netPay as number || 0;

    // Check calculations
    const calculatedDeductions = employeeNIC + incomeTax + (filingData.studentLoan as number || 0);
    if (Math.abs(calculatedDeductions - totalDeductions) > 0.01) {
      errors.push(`Total deductions mismatch: calculated ${calculatedDeductions}, provided ${totalDeductions}`);
    }

    const calculatedNet = grossPay - totalDeductions;
    if (Math.abs(calculatedNet - netPay) > 0.01) {
      errors.push(`Net pay mismatch: calculated ${calculatedNet}, provided ${netPay}`);
    }

    // Check NIC rates (should be around 12% for employee, 13.8% for employer)
    if (grossPay > 0) {
      const employeeNICRate = employeeNIC / grossPay;
      if (employeeNICRate > 0.15 || employeeNICRate < 0) {
        warnings.push(`Employee NIC rate appears unusual: ${(employeeNICRate * 100).toFixed(2)}%`);
      }

      const employerNICRate = employerNIC / grossPay;
      if (employerNICRate > 0.20 || employerNICRate < 0) {
        warnings.push(`Employer NIC rate appears unusual: ${(employerNICRate * 100).toFixed(2)}%`);
      }
    }
  } else if (filingType === 'corporation_tax') {
    // Validate Corporation Tax calculation
    const profitBeforeTax = filingData.profitBeforeTax as number || 0;
    const corporationTax = filingData.corporationTax as number || 0;
    const taxRate = filingData.taxRate as number || 0;

    // Check tax rate is reasonable (UK: 19% or 25%)
    if (taxRate < 0.15 || taxRate > 0.30) {
      warnings.push(`Corporation tax rate appears unusual: ${taxRate * 100}%`);
    }

    // Check calculation
    const calculatedTax = profitBeforeTax * taxRate;
    if (Math.abs(calculatedTax - corporationTax) > 0.01) {
      errors.push(`Corporation tax mismatch: calculated ${calculatedTax}, provided ${corporationTax}`);
    }
  }

  const isValid = errors.length === 0;
  const confidence = isValid && warnings.length === 0 ? 1.0 : isValid ? 0.8 : 0.5;

  return {
    isValid,
    errors,
    warnings,
    confidence,
  };
}
