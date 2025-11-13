import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { getEntityTaxProfile } from './ukTaxEntities';

const logger = createLogger('rules-engine-service');

export interface YearEndChecklist {
  entityType: string;
  taxYear: string;
  items: Array<{
    category: string;
    item: string;
    status: 'pending' | 'completed' | 'not_applicable';
    dueDate?: Date;
    notes?: string;
  }>;
  completion: number; // 0-100
}

/**
 * Generate tax year-end checklist
 */
export async function generateYearEndChecklist(
  tenantId: TenantId,
  taxYear: string
): Promise<YearEndChecklist> {
  logger.info('Generating year-end checklist', { tenantId, taxYear });

  const profile = await getEntityTaxProfile(tenantId);
  const items: YearEndChecklist['items'] = [];

  // Common items for all entities
  items.push(
    {
      category: 'Accounts',
      item: 'Finalize all transactions for the tax year',
      status: 'pending',
      dueDate: new Date(`${taxYear.split('-')[1]}-01-31`), // End of tax year
    },
    {
      category: 'Accounts',
      item: 'Complete bank reconciliation',
      status: 'pending',
      dueDate: new Date(`${taxYear.split('-')[1]}-01-31`),
    },
    {
      category: 'Accounts',
      item: 'Post all accruals and prepayments',
      status: 'pending',
      dueDate: new Date(`${taxYear.split('-')[1]}-01-31`),
    },
    {
      category: 'Accounts',
      item: 'Calculate and post depreciation',
      status: 'pending',
      dueDate: new Date(`${taxYear.split('-')[1]}-01-31`),
    },
    {
      category: 'Accounts',
      item: 'Generate final financial statements',
      status: 'pending',
      dueDate: new Date(`${taxYear.split('-')[1]}-02-28`),
    }
  );

  // Entity-specific items
  if (profile.entityType === 'ltd' || profile.entityType === 'plc') {
    items.push(
      {
        category: 'Corporation Tax',
        item: 'Prepare Corporation Tax computation',
        status: 'pending',
        dueDate: new Date(`${taxYear.split('-')[1]}-12-31`), // 9 months after year end
      },
      {
        category: 'Corporation Tax',
        item: 'File CT600 return',
        status: 'pending',
        dueDate: new Date(`${taxYear.split('-')[1]}-12-31`),
      },
      {
        category: 'Accounts',
        item: 'Prepare annual accounts',
        status: 'pending',
        dueDate: new Date(`${taxYear.split('-')[1]}-09-30`), // 9 months after year end
      },
      {
        category: 'Accounts',
        item: 'File accounts with Companies House',
        status: 'pending',
        dueDate: new Date(`${taxYear.split('-')[1]}-09-30`),
      }
    );
  } else {
    items.push(
      {
        category: 'Self Assessment',
        item: 'Complete Self Assessment tax return',
        status: 'pending',
        dueDate: new Date(`${taxYear.split('-')[1]}-01-31`),
      },
      {
        category: 'Self Assessment',
        item: 'Submit SA100 to HMRC',
        status: 'pending',
        dueDate: new Date(`${taxYear.split('-')[1]}-01-31`),
      }
    );
  }

  // VAT items
  items.push(
    {
      category: 'VAT',
      item: 'Complete final VAT return for the year',
      status: 'pending',
      dueDate: new Date(`${taxYear.split('-')[1]}-02-07`), // 1 month + 7 days
    },
    {
      category: 'VAT',
      item: 'Submit final VAT return to HMRC',
      status: 'pending',
      dueDate: new Date(`${taxYear.split('-')[1]}-02-07`),
    }
  );

  // PAYE items (if applicable)
  if (profile.nationalInsurance.class1.employeeRate > 0) {
    items.push(
      {
        category: 'PAYE',
        item: 'Complete final PAYE return',
        status: 'pending',
        dueDate: new Date(`${taxYear.split('-')[1]}-02-19`),
      },
      {
        category: 'PAYE',
        item: 'Submit P35 to HMRC',
        status: 'pending',
        dueDate: new Date(`${taxYear.split('-')[1]}-02-19`),
      }
    );
  }

  // Calculate completion
  const completed = items.filter(i => i.status === 'completed').length;
  const completion = items.length > 0 ? (completed / items.length) * 100 : 0;

  return {
    entityType: profile.entityType,
    taxYear,
    items,
    completion: Math.round(completion),
  };
}

/**
 * Get year-end deadlines
 */
export async function getYearEndDeadlines(
  tenantId: TenantId,
  taxYear: string
): Promise<Array<{
  filing: string;
  deadline: Date;
  daysRemaining: number;
  priority: 'high' | 'medium' | 'low';
}>> {
  const profile = await getEntityTaxProfile(tenantId);
  const deadlines: Array<{
    filing: string;
    deadline: Date;
    daysRemaining: number;
    priority: 'high' | 'medium' | 'low';
  }> = [];

  const yearEnd = new Date(`${taxYear.split('-')[1]}-04-05`); // UK tax year ends 5 April

  // Self Assessment deadline
  if (profile.entityType !== 'ltd' && profile.entityType !== 'plc') {
    const saDeadline = new Date(`${taxYear.split('-')[1]}-01-31`);
    const daysRemaining = Math.ceil((saDeadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    deadlines.push({
      filing: 'Self Assessment',
      deadline: saDeadline,
      daysRemaining,
      priority: daysRemaining < 30 ? 'high' : daysRemaining < 60 ? 'medium' : 'low',
    });
  }

  // Corporation Tax deadline
  if (profile.entityType === 'ltd' || profile.entityType === 'plc') {
    const ctDeadline = new Date(yearEnd);
    ctDeadline.setMonth(ctDeadline.getMonth() + 9);
    const daysRemaining = Math.ceil((ctDeadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    deadlines.push({
      filing: 'Corporation Tax',
      deadline: ctDeadline,
      daysRemaining,
      priority: daysRemaining < 30 ? 'high' : daysRemaining < 60 ? 'medium' : 'low',
    });
  }

  return deadlines.sort((a, b) => a.daysRemaining - b.daysRemaining);
}
