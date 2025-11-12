import { AutomationRule } from './ruleEngine';
import { TenantId } from '@ai-accountant/shared-types';

// Pre-built Automation Rule Templates
export const ruleTemplates: Array<{
  name: string;
  description: string;
  rule: Omit<AutomationRule, 'id' | 'tenantId'>;
}> = [
  {
    name: 'Auto-categorize Office Supplies',
    description: 'Automatically categorize transactions containing office supply keywords',
    rule: {
      name: 'Auto-categorize Office Supplies',
      description: 'Categorizes office supply transactions',
      trigger: {
        type: 'transaction',
        conditions: {
          description: 'office|supplies|stationery',
          amountMin: 0,
        },
      },
      actions: [
        {
          type: 'categorize',
          parameters: {
            category: 'Office Supplies',
            accountCode: '6001',
          },
        },
      ],
      isActive: true,
    },
  },
  {
    name: 'Auto-categorize Travel Expenses',
    description: 'Automatically categorize travel-related transactions',
    rule: {
      name: 'Auto-categorize Travel',
      description: 'Categorizes travel expenses',
      trigger: {
        type: 'transaction',
        conditions: {
          description: 'travel|hotel|flight|train|uber|taxi',
        },
      },
      actions: [
        {
          type: 'categorize',
          parameters: {
            category: 'Travel',
            accountCode: '6002',
          },
        },
      ],
      isActive: true,
    },
  },
  {
    name: 'Notify on Large Expenses',
    description: 'Send notification when expense exceeds threshold',
    rule: {
      name: 'Large Expense Alert',
      description: 'Alerts on large expenses',
      trigger: {
        type: 'threshold',
        conditions: {
          threshold: 1000,
          field: 'amount',
        },
      },
      actions: [
        {
          type: 'send_notification',
          parameters: {
            type: 'email',
            subject: 'Large Expense Detected',
          },
        },
      ],
      isActive: true,
    },
  },
];

export function getRuleTemplate(name: string): (Omit<AutomationRule, 'id' | 'tenantId'>) | null {
  const template = ruleTemplates.find(t => t.name === name);
  return template ? template.rule : null;
}

export function createRuleFromTemplate(
  tenantId: TenantId,
  templateName: string
): AutomationRule {
  const template = getRuleTemplate(templateName);
  if (!template) {
    throw new Error(`Template not found: ${templateName}`);
  }

  return {
    id: crypto.randomUUID(),
    tenantId,
    ...template,
  };
}
