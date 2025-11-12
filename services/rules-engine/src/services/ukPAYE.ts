import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { getEntityTaxProfile } from './ukTaxEntities';

const logger = createLogger('rules-engine-service');

export interface PAYEEmployee {
  employeeId: string;
  name: string;
  niNumber: string;
  taxCode: string;
  dateOfBirth: Date;
  startDate: Date;
  endDate?: Date;
  isDirector: boolean;
  isApprentice: boolean;
  isUnder21: boolean;
  isUnder25: boolean;
}

export interface PAYEPayment {
  employeeId: string;
  payPeriod: {
    start: Date;
    end: Date;
  };
  grossPay: number;
  pensionContribution: number;
  studentLoan: {
    plan1: number;
    plan2: number;
    plan4: number;
    postgraduate: number;
  };
  benefits: {
    companyCar: number;
    fuelBenefit: number;
    medicalInsurance: number;
    other: number;
  };
  expenses: number;
  statutoryPay: {
    sickPay: number;
    maternityPay: number;
    paternityPay: number;
    adoptionPay: number;
    sharedParentalPay: number;
  };
}

export interface PAYECalculation {
  employeeId: string;
  payPeriod: {
    start: Date;
    end: Date;
  };
  grossPay: number;
  taxablePay: number;
  incomeTax: {
    code: string;
    freePay: number;
    taxable: number;
    tax: number;
    cumulativeTax: number;
  };
  nationalInsurance: {
    employee: number;
    employer: number;
    cumulativeEmployee: number;
    cumulativeEmployer: number;
  };
  studentLoan: {
    plan1: number;
    plan2: number;
    plan4: number;
    postgraduate: number;
    total: number;
  };
  pension: {
    employee: number;
    employer: number;
    total: number;
  };
  netPay: number;
  employerCost: number;
}

export interface PAYEReturn {
  period: {
    start: Date;
    end: Date;
  };
  employees: PAYECalculation[];
  totals: {
    grossPay: number;
    incomeTax: number;
    nationalInsuranceEmployee: number;
    nationalInsuranceEmployer: number;
    studentLoan: number;
    pensionEmployee: number;
    pensionEmployer: number;
    netPay: number;
    employerCost: number;
  };
  hmrcPayments: {
    incomeTax: number;
    nationalInsurance: number;
    studentLoan: number;
    apprenticeshipLevy: number;
    total: number;
  };
}

// Tax Code Allowances 2024-25
const TAX_CODE_ALLOWANCES: Record<string, number> = {
  '1257L': 12570, // Standard personal allowance
  '1250L': 12500, // Reduced personal allowance
  'BR': 0, // Basic rate (no personal allowance)
  'D0': 0, // Higher rate (no personal allowance)
  'D1': 0, // Additional rate (no personal allowance)
  'NT': 0, // No tax
  'K': -12570, // K code (negative allowance)
};

// Student Loan Thresholds 2024-25
const STUDENT_LOAN_THRESHOLDS = {
  plan1: 22015, // Annual
  plan2: 27295, // Annual
  plan4: 25000, // Annual (Scotland)
  postgraduate: 21000, // Annual
};

// Student Loan Rates
const STUDENT_LOAN_RATES = {
  plan1: 0.09,
  plan2: 0.09,
  plan4: 0.09,
  postgraduate: 0.06,
};

// Apprenticeship Levy
const APPRENTICESHIP_LEVY_THRESHOLD = 3000000; // Annual payroll
const APPRENTICESHIP_LEVY_RATE = 0.005; // 0.5%

export async function calculatePAYE(
  tenantId: TenantId,
  employee: PAYEEmployee,
  payment: PAYEPayment,
  cumulativeData: {
    grossPay?: number;
    incomeTax?: number;
    niEmployee?: number;
    niEmployer?: number;
  } = {}
): Promise<PAYECalculation> {
  const profile = await getEntityTaxProfile(tenantId);
  const { nationalInsurance, incomeTax } = profile;

  // Calculate taxable pay
  const benefitsValue = 
    payment.benefits.companyCar +
    payment.benefits.fuelBenefit +
    payment.benefits.medicalInsurance +
    payment.benefits.other;

  const taxablePay = payment.grossPay + benefitsValue - payment.expenses;

  // Calculate free pay from tax code
  const taxCode = employee.taxCode.replace(/[^0-9]/g, '');
  const annualFreePay = TAX_CODE_ALLOWANCES[employee.taxCode] || 
    (taxCode ? parseInt(taxCode) * 10 : incomeTax.personalAllowance);
  
  const monthlyFreePay = annualFreePay / 12;
  const weeklyFreePay = annualFreePay / 52;
  const daysInPeriod = Math.ceil(
    (payment.payPeriod.end.getTime() - payment.payPeriod.start.getTime()) / (1000 * 60 * 60 * 24)
  );
  const periodFreePay = (annualFreePay / 365) * daysInPeriod;

  // Cumulative taxable pay
  const cumulativeTaxablePay = (cumulativeData.grossPay || 0) + taxablePay;
  const cumulativeFreePay = (annualFreePay / 365) * 
    Math.ceil((payment.payPeriod.end.getTime() - employee.startDate.getTime()) / (1000 * 60 * 60 * 24));

  const cumulativeTaxable = Math.max(0, cumulativeTaxablePay - cumulativeFreePay);
  const periodTaxable = Math.max(0, taxablePay - periodFreePay);

  // Income Tax calculation
  let incomeTaxAmount = 0;
  let cumulativeIncomeTax = 0;

  if (employee.taxCode !== 'NT' && employee.taxCode !== 'BR' && employee.taxCode !== 'D0' && employee.taxCode !== 'D1') {
    // Calculate cumulative tax
    const cumulativeBasicRate = Math.min(
      cumulativeTaxable,
      incomeTax.basicRate.threshold - annualFreePay
    );
    const cumulativeHigherRate = Math.max(0, Math.min(
      cumulativeTaxable - (incomeTax.basicRate.threshold - annualFreePay),
      incomeTax.higherRate.threshold - incomeTax.basicRate.threshold
    ));
    const cumulativeAdditionalRate = Math.max(0, 
      cumulativeTaxable - (incomeTax.higherRate.threshold - annualFreePay)
    );

    cumulativeIncomeTax = 
      cumulativeBasicRate * incomeTax.basicRate.rate +
      cumulativeHigherRate * incomeTax.higherRate.rate +
      cumulativeAdditionalRate * incomeTax.additionalRate.rate;

    // Period tax is difference
    const previousCumulativeTax = cumulativeData.incomeTax || 0;
    incomeTaxAmount = cumulativeIncomeTax - previousCumulativeTax;
  } else if (employee.taxCode === 'BR') {
    // Basic rate only
    incomeTaxAmount = periodTaxable * incomeTax.basicRate.rate;
    cumulativeIncomeTax = (cumulativeData.incomeTax || 0) + incomeTaxAmount;
  } else if (employee.taxCode === 'D0') {
    // Higher rate only
    incomeTaxAmount = periodTaxable * incomeTax.higherRate.rate;
    cumulativeIncomeTax = (cumulativeData.incomeTax || 0) + incomeTaxAmount;
  } else if (employee.taxCode === 'D1') {
    // Additional rate only
    incomeTaxAmount = periodTaxable * incomeTax.additionalRate.rate;
    cumulativeIncomeTax = (cumulativeData.incomeTax || 0) + incomeTaxAmount;
  }

  // National Insurance
  const niThreshold = nationalInsurance.class1.thresholds.primary;
  const niUpperThreshold = nationalInsurance.class1.thresholds.upper;
  
  const cumulativeGrossPay = (cumulativeData.grossPay || 0) + payment.grossPay;
  const cumulativeNiEmployee = calculateCumulativeNI(
    cumulativeGrossPay,
    niThreshold,
    niUpperThreshold,
    nationalInsurance.class1.employeeRate
  );
  const cumulativeNiEmployer = calculateCumulativeNI(
    cumulativeGrossPay,
    niThreshold,
    niUpperThreshold,
    nationalInsurance.class1.employerRate
  );

  const periodNiEmployee = cumulativeNiEmployee - (cumulativeData.niEmployee || 0);
  const periodNiEmployer = cumulativeNiEmployer - (cumulativeData.niEmployer || 0);

  // Student Loan
  const annualGrossPay = (cumulativeGrossPay / daysInPeriod) * 365;
  const studentLoan = {
    plan1: annualGrossPay >= STUDENT_LOAN_THRESHOLDS.plan1 
      ? payment.grossPay * STUDENT_LOAN_RATES.plan1 : 0,
    plan2: annualGrossPay >= STUDENT_LOAN_THRESHOLDS.plan2 
      ? payment.grossPay * STUDENT_LOAN_RATES.plan2 : 0,
    plan4: annualGrossPay >= STUDENT_LOAN_THRESHOLDS.plan4 
      ? payment.grossPay * STUDENT_LOAN_RATES.plan4 : 0,
    postgraduate: annualGrossPay >= STUDENT_LOAN_THRESHOLDS.postgraduate 
      ? payment.grossPay * STUDENT_LOAN_RATES.postgraduate : 0,
  };
  const totalStudentLoan = studentLoan.plan1 + studentLoan.plan2 + studentLoan.plan4 + studentLoan.postgraduate;

  // Pension (auto-enrolment)
  const pensionEmployee = payment.pensionContribution;
  const pensionEmployer = payment.pensionContribution * 0.03; // Minimum 3% employer contribution

  // Net Pay
  const netPay = payment.grossPay - incomeTaxAmount - periodNiEmployee - totalStudentLoan - pensionEmployee;

  // Employer Cost
  const employerCost = payment.grossPay + periodNiEmployer + pensionEmployer + benefitsValue;

  return {
    employeeId: employee.employeeId,
    payPeriod: payment.payPeriod,
    grossPay: payment.grossPay,
    taxablePay,
    incomeTax: {
      code: employee.taxCode,
      freePay: periodFreePay,
      taxable: periodTaxable,
      tax: incomeTaxAmount,
      cumulativeTax: cumulativeIncomeTax,
    },
    nationalInsurance: {
      employee: periodNiEmployee,
      employer: periodNiEmployer,
      cumulativeEmployee: cumulativeNiEmployee,
      cumulativeEmployer: cumulativeNiEmployer,
    },
    studentLoan,
    pension: {
      employee: pensionEmployee,
      employer: pensionEmployer,
      total: pensionEmployee + pensionEmployer,
    },
    netPay,
    employerCost,
  };
}

function calculateCumulativeNI(
  cumulativeGrossPay: number,
  threshold: number,
  upperThreshold: number,
  rate: number
): number {
  if (cumulativeGrossPay <= threshold) {
    return 0;
  }

  const lowerBand = Math.min(cumulativeGrossPay - threshold, upperThreshold - threshold);
  const upperBand = Math.max(0, cumulativeGrossPay - upperThreshold);

  return lowerBand * rate + upperBand * rate;
}

export async function generatePAYEReturn(
  tenantId: TenantId,
  employees: PAYEEmployee[],
  payments: PAYEPayment[],
  period: { start: Date; end: Date }
): Promise<PAYEReturn> {
  const calculations: PAYECalculation[] = [];

  for (const employee of employees) {
    const employeePayments = payments.filter(p => p.employeeId === employee.employeeId);
    
    for (const payment of employeePayments) {
      // Get cumulative data (would come from database in production)
      const calculation = await calculatePAYE(tenantId, employee, payment);
      calculations.push(calculation);
    }
  }

  // Calculate totals
  const totals = {
    grossPay: calculations.reduce((sum, c) => sum + c.grossPay, 0),
    incomeTax: calculations.reduce((sum, c) => sum + c.incomeTax.tax, 0),
    nationalInsuranceEmployee: calculations.reduce((sum, c) => sum + c.nationalInsurance.employee, 0),
    nationalInsuranceEmployer: calculations.reduce((sum, c) => sum + c.nationalInsurance.employer, 0),
    studentLoan: calculations.reduce((sum, c) => sum + c.studentLoan.total, 0),
    pensionEmployee: calculations.reduce((sum, c) => sum + c.pension.employee, 0),
    pensionEmployer: calculations.reduce((sum, c) => sum + c.pension.employer, 0),
    netPay: calculations.reduce((sum, c) => sum + c.netPay, 0),
    employerCost: calculations.reduce((sum, c) => sum + c.employerCost, 0),
  };

  // Apprenticeship Levy
  const annualPayroll = totals.grossPay * 12; // Approximate
  const apprenticeshipLevy = annualPayroll > APPRENTICESHIP_LEVY_THRESHOLD
    ? (annualPayroll - APPRENTICESHIP_LEVY_THRESHOLD) * APPRENTICESHIP_LEVY_RATE / 12
    : 0;

  const hmrcPayments = {
    incomeTax: totals.incomeTax,
    nationalInsurance: totals.nationalInsuranceEmployee + totals.nationalInsuranceEmployer,
    studentLoan: totals.studentLoan,
    apprenticeshipLevy,
    total: totals.incomeTax + totals.nationalInsuranceEmployee + totals.nationalInsuranceEmployer + totals.studentLoan + apprenticeshipLevy,
  };

  return {
    period,
    employees: calculations,
    totals,
    hmrcPayments,
  };
}
