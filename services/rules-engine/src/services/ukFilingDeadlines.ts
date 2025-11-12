import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { getEntityTaxProfile, UKEntityType } from './ukTaxEntities';

const logger = createLogger('rules-engine-service');

export interface FilingDeadline {
  type: 'self_assessment' | 'corporation_tax' | 'vat' | 'paye' | 'paye_final' | 'cis';
  description: string;
  dueDate: Date;
  periodStart: Date;
  periodEnd: Date;
  daysUntilDue: number;
  isOverdue: boolean;
  penalty: {
    applicable: boolean;
    amount: number;
    description: string;
  };
}

export interface FilingDeadlineSummary {
  entityType: UKEntityType;
  upcoming: FilingDeadline[];
  overdue: FilingDeadline[];
  all: FilingDeadline[];
}

export async function calculateFilingDeadlines(
  tenantId: TenantId,
  asOfDate: Date = new Date()
): Promise<FilingDeadlineSummary> {
  const profile = await getEntityTaxProfile(tenantId);
  const deadlines: FilingDeadline[] = [];

  // Self Assessment (Income Tax)
  if (profile.incomeTax.applicable) {
    const taxYearEnd = getTaxYearEnd(asOfDate);
    const selfAssessmentDeadline = new Date(taxYearEnd);
    selfAssessmentDeadline.setMonth(selfAssessmentDeadline.getMonth() + 10);
    selfAssessmentDeadline.setDate(31); // 31 January

    deadlines.push({
      type: 'self_assessment',
      description: 'Self Assessment Tax Return',
      dueDate: selfAssessmentDeadline,
      periodStart: new Date(taxYearEnd.getFullYear() - 1, 3, 6), // 6 April
      periodEnd: taxYearEnd,
      daysUntilDue: Math.floor((selfAssessmentDeadline.getTime() - asOfDate.getTime()) / (1000 * 60 * 60 * 24)),
      isOverdue: selfAssessmentDeadline < asOfDate,
      penalty: calculateSelfAssessmentPenalty(selfAssessmentDeadline, asOfDate),
    });
  }

  // Corporation Tax
  if (profile.corporationTax.applicable) {
    // Get company year end from tenant
    const yearEnd = await getCompanyYearEnd(tenantId);
    if (yearEnd) {
      const corporationTaxDeadline = new Date(yearEnd);
      corporationTaxDeadline.setMonth(corporationTaxDeadline.getMonth() + 9);
      corporationTaxDeadline.setDate(1); // 1st of month, 9 months after year end

      deadlines.push({
        type: 'corporation_tax',
        description: 'Corporation Tax Return',
        dueDate: corporationTaxDeadline,
        periodStart: new Date(yearEnd.getFullYear() - 1, yearEnd.getMonth(), yearEnd.getDate() + 1),
        periodEnd: yearEnd,
        daysUntilDue: Math.floor((corporationTaxDeadline.getTime() - asOfDate.getTime()) / (1000 * 60 * 60 * 24)),
        isOverdue: corporationTaxDeadline < asOfDate,
        penalty: calculateCorporationTaxPenalty(corporationTaxDeadline, asOfDate),
      });
    }
  }

  // VAT Returns
  if (profile.vat.registrationThreshold > 0) {
    const vatPeriods = calculateVATPeriods(asOfDate);
    for (const period of vatPeriods) {
      const vatDeadline = new Date(period.end);
      vatDeadline.setMonth(vatDeadline.getMonth() + 1);
      vatDeadline.setDate(vatDeadline.getDate() + 7); // 1 month + 7 days

      deadlines.push({
        type: 'vat',
        description: `VAT Return - ${period.quarter}`,
        dueDate: vatDeadline,
        periodStart: period.start,
        periodEnd: period.end,
        daysUntilDue: Math.floor((vatDeadline.getTime() - asOfDate.getTime()) / (1000 * 60 * 60 * 24)),
        isOverdue: vatDeadline < asOfDate,
        penalty: calculateVATPenalty(vatDeadline, asOfDate),
      });
    }
  }

  // PAYE
  if (profile.nationalInsurance.class1.employeeRate > 0) {
    const payeDeadline = new Date(asOfDate);
    payeDeadline.setMonth(payeDeadline.getMonth() + 1);
    payeDeadline.setDate(19); // 19th of following month

    deadlines.push({
      type: 'paye',
      description: 'PAYE Payment',
      dueDate: payeDeadline,
      periodStart: new Date(asOfDate.getFullYear(), asOfDate.getMonth(), 1),
      periodEnd: new Date(asOfDate.getFullYear(), asOfDate.getMonth() + 1, 0),
      daysUntilDue: Math.floor((payeDeadline.getTime() - asOfDate.getTime()) / (1000 * 60 * 60 * 24)),
      isOverdue: payeDeadline < asOfDate,
      penalty: calculatePAYEPenalty(payeDeadline, asOfDate),
    });
  }

  const upcoming = deadlines.filter(d => !d.isOverdue && d.daysUntilDue <= 30);
  const overdue = deadlines.filter(d => d.isOverdue);

  return {
    entityType: profile.entityType,
    upcoming,
    overdue,
    all: deadlines.sort((a, b) => a.daysUntilDue - b.daysUntilDue),
  };
}

function getTaxYearEnd(date: Date): Date {
  // UK tax year runs 6 April to 5 April
  const year = date.getMonth() >= 3 ? date.getFullYear() + 1 : date.getFullYear();
  return new Date(year, 3, 5); // 5 April
}

async function getCompanyYearEnd(tenantId: TenantId): Promise<Date | null> {
  // Would query database for company year end
  // Default to 31 March if not set
  const currentYear = new Date().getFullYear();
  return new Date(currentYear, 2, 31); // 31 March
}

function calculateVATPeriods(asOfDate: Date): Array<{ start: Date; end: Date; quarter: string }> {
  const periods: Array<{ start: Date; end: Date; quarter: string }> = [];
  
  // Calculate last 4 quarters
  for (let i = 0; i < 4; i++) {
    const periodEnd = new Date(asOfDate);
    periodEnd.setMonth(periodEnd.getMonth() - (i * 3));
    const periodStart = new Date(periodEnd);
    periodStart.setMonth(periodStart.getMonth() - 3);
    
    const quarter = `Q${Math.floor(periodEnd.getMonth() / 3) + 1} ${periodEnd.getFullYear()}`;
    periods.push({ start: periodStart, end: periodEnd, quarter });
  }
  
  return periods;
}

function calculateSelfAssessmentPenalty(deadline: Date, asOfDate: Date): { applicable: boolean; amount: number; description: string } {
  if (deadline >= asOfDate) {
    return { applicable: false, amount: 0, description: '' };
  }

  const daysLate = Math.floor((asOfDate.getTime() - deadline.getTime()) / (1000 * 60 * 60 * 24));
  
  if (daysLate <= 30) {
    return { applicable: true, amount: 100, description: 'Fixed £100 penalty' };
  } else if (daysLate <= 90) {
    return { applicable: true, amount: 100 + (daysLate - 30) * 10, description: 'Daily penalty £10 per day' };
  } else {
    return { applicable: true, amount: 100 + 600 + (daysLate - 90) * 10, description: 'Additional penalty + daily penalty' };
  }
}

function calculateCorporationTaxPenalty(deadline: Date, asOfDate: Date): { applicable: boolean; amount: number; description: string } {
  if (deadline >= asOfDate) {
    return { applicable: false, amount: 0, description: '' };
  }

  const daysLate = Math.floor((asOfDate.getTime() - deadline.getTime()) / (1000 * 60 * 60 * 24));
  
  if (daysLate <= 30) {
    return { applicable: true, amount: 100, description: 'Fixed £100 penalty' };
  } else if (daysLate <= 90) {
    return { applicable: true, amount: 200, description: 'Additional £200 penalty' };
  } else {
    return { applicable: true, amount: 200 + (daysLate - 90) * 10, description: 'Daily penalty £10 per day' };
  }
}

function calculateVATPenalty(deadline: Date, asOfDate: Date): { applicable: boolean; amount: number; description: string } {
  if (deadline >= asOfDate) {
    return { applicable: false, amount: 0, description: '' };
  }

  const daysLate = Math.floor((asOfDate.getTime() - deadline.getTime()) / (1000 * 60 * 60 * 24));
  
  // Default penalty
  if (daysLate <= 15) {
    return { applicable: true, amount: 0, description: 'No penalty if paid within 15 days' };
  } else {
    return { applicable: true, amount: 50 + (daysLate - 15) * 5, description: 'Default penalty + daily penalty' };
  }
}

function calculatePAYEPenalty(deadline: Date, asOfDate: Date): { applicable: boolean; amount: number; description: string } {
  if (deadline >= asOfDate) {
    return { applicable: false, amount: 0, description: '' };
  }

  const daysLate = Math.floor((asOfDate.getTime() - deadline.getTime()) / (1000 * 60 * 60 * 24));
  
  if (daysLate <= 3) {
    return { applicable: false, amount: 0, description: 'No penalty if paid within 3 days' };
  } else if (daysLate <= 14) {
    return { applicable: true, amount: 100, description: 'Fixed £100 penalty' };
  } else {
    return { applicable: true, amount: 200 + (daysLate - 14) * 5, description: 'Additional penalty + daily penalty' };
  }
}
