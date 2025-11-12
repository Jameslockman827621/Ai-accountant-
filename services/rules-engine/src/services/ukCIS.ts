import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';

const logger = createLogger('rules-engine-service');

// Construction Industry Scheme Rates
const CIS_RATE_STANDARD = 0.20; // 20% deduction
const CIS_RATE_LOWER = 0.00; // 0% for gross payment status
const CIS_RATE_HIGHER = 0.30; // 30% for unregistered

export interface CISSubcontractor {
  subcontractorId: string;
  name: string;
  utr: string; // Unique Taxpayer Reference
  nino?: string;
  cisStatus: 'gross' | 'net' | 'unregistered';
  verificationNumber?: string;
}

export interface CISPayment {
  subcontractorId: string;
  paymentDate: Date;
  grossAmount: number;
  materials: number;
  labour: number;
  cisDeduction: number;
  netPayment: number;
  period: {
    start: Date;
    end: Date;
  };
}

export interface CISReturn {
  period: {
    start: Date;
    end: Date;
  };
  contractorName: string;
  contractorUTR: string;
  payments: CISPayment[];
  totals: {
    grossPayments: number;
    materials: number;
    labour: number;
    cisDeductions: number;
    netPayments: number;
  };
  hmrcPayment: number;
  filingDeadline: Date;
}

export async function calculateCISDeduction(
  subcontractor: CISSubcontractor,
  grossAmount: number,
  materials: number = 0
): Promise<{
  grossAmount: number;
  materials: number;
  labour: number;
  deductionRate: number;
  cisDeduction: number;
  netPayment: number;
}> {
  const labour = grossAmount - materials;

  let deductionRate = CIS_RATE_STANDARD;
  if (subcontractor.cisStatus === 'gross') {
    deductionRate = CIS_RATE_LOWER;
  } else if (subcontractor.cisStatus === 'unregistered') {
    deductionRate = CIS_RATE_HIGHER;
  }

  // CIS deduction is on labour only, not materials
  const cisDeduction = labour * deductionRate;
  const netPayment = grossAmount - cisDeduction;

  return {
    grossAmount,
    materials,
    labour,
    deductionRate,
    cisDeduction,
    netPayment,
  };
}

export async function generateCISReturn(
  tenantId: TenantId,
  period: { start: Date; end: Date },
  payments: Array<{
    subcontractorId: string;
    paymentDate: Date;
    grossAmount: number;
    materials: number;
  }>
): Promise<CISReturn> {
  // Get contractor details
  const contractorResult = await db.query<{
    name: string;
    tax_id: string;
  }>(
    'SELECT name, tax_id FROM tenants WHERE id = $1',
    [tenantId]
  );

  const contractor = contractorResult.rows[0];
  if (!contractor) {
    throw new Error('Contractor not found');
  }

  // Get subcontractor details
  const cisPayments: CISPayment[] = [];

  for (const payment of payments) {
    // Get subcontractor details (would come from database)
    const subcontractor: CISSubcontractor = {
      subcontractorId: payment.subcontractorId,
      name: 'Subcontractor Name', // Would fetch from database
      utr: '1234567890', // Would fetch from database
      cisStatus: 'net',
    };

    const calculation = await calculateCISDeduction(
      subcontractor,
      payment.grossAmount,
      payment.materials
    );

    cisPayments.push({
      subcontractorId: payment.subcontractorId,
      paymentDate: payment.paymentDate,
      grossAmount: calculation.grossAmount,
      materials: calculation.materials,
      labour: calculation.labour,
      cisDeduction: calculation.cisDeduction,
      netPayment: calculation.netPayment,
      period,
    });
  }

  // Calculate totals
  const totals = {
    grossPayments: cisPayments.reduce((sum, p) => sum + p.grossAmount, 0),
    materials: cisPayments.reduce((sum, p) => sum + p.materials, 0),
    labour: cisPayments.reduce((sum, p) => sum + p.labour, 0),
    cisDeductions: cisPayments.reduce((sum, p) => sum + p.cisDeduction, 0),
    netPayments: cisPayments.reduce((sum, p) => sum + p.netPayment, 0),
  };

  // Filing deadline is 19th of following month
  const filingDeadline = new Date(period.end);
  filingDeadline.setMonth(filingDeadline.getMonth() + 1);
  filingDeadline.setDate(19);

  return {
    period,
    contractorName: contractor.name,
    contractorUTR: contractor.tax_id || '',
    payments: cisPayments,
    totals,
    hmrcPayment: totals.cisDeductions,
    filingDeadline,
  };
}

export async function verifyCISSubcontractor(
  utr: string,
  nino?: string
): Promise<{
  verified: boolean;
  cisStatus: 'gross' | 'net' | 'unregistered';
  verificationNumber?: string;
  name?: string;
}> {
  try {
    // In production, this would call HMRC CIS verification API
    // For now, return mock data
    logger.info('CIS subcontractor verification', { utr, nino });

    // HMRC CIS verification would return:
    // - Verification number
    // - CIS status (gross/net)
    // - Name match

    return {
      verified: true,
      cisStatus: 'net',
      verificationNumber: `VER${utr.substring(0, 6)}`,
      name: 'Verified Subcontractor',
    };
  } catch (error) {
    logger.error('CIS verification failed', error instanceof Error ? error : new Error(String(error)));
    return {
      verified: false,
      cisStatus: 'unregistered',
    };
  }
}

export async function checkCISRegistration(tenantId: TenantId): Promise<{
  registered: boolean;
  registrationNumber?: string;
  required: boolean;
  recommendation: string;
}> {
  // Check if tenant is in construction industry
  const industryResult = await db.query<{ industry: string | null }>(
    'SELECT industry FROM tenants WHERE id = $1',
    [tenantId]
  );

  const industry = industryResult.rows[0]?.industry;
  const isConstruction = industry === 'construction';

  // Check if registered
  const cisResult = await db.query<{ cis_number: string | null }>(
    'SELECT cis_number FROM tenants WHERE id = $1',
    [tenantId]
  );

  const registered = !!cisResult.rows[0]?.cis_number;

  if (isConstruction && !registered) {
    return {
      registered: false,
      required: true,
      recommendation: 'Register for CIS with HMRC. Required if paying subcontractors in construction industry.',
    };
  }

  return {
    registered,
    registrationNumber: cisResult.rows[0]?.cis_number || undefined,
    required: isConstruction,
    recommendation: registered
      ? 'CIS registration active'
      : 'CIS registration not required for your industry',
  };
}
