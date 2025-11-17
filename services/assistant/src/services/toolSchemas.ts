/**
 * Tool Schemas for OpenAI Function Calling
 * Defines all available tools with their schemas for deterministic tool routing
 */

import { ChatCompletionTool } from 'openai/resources/chat/completions';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
  requiresApproval: boolean;
  isIrreversible: boolean;
  rateLimitPerTenant?: number; // requests per hour
}

/**
 * Get ledger entries for analysis
 */
export const getLedgerSliceTool: ToolDefinition = {
  name: 'get_ledger_slice',
  description: 'Retrieve ledger entries for a specific date range and optionally filter by account codes. Use this to analyze transactions, calculate totals, or review account activity.',
  parameters: {
    type: 'object',
    properties: {
      startDate: {
        type: 'string',
        format: 'date',
        description: 'Start date for the ledger slice (YYYY-MM-DD)',
      },
      endDate: {
        type: 'string',
        format: 'date',
        description: 'End date for the ledger slice (YYYY-MM-DD)',
      },
      accountCodes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional array of account codes to filter by',
      },
    },
    required: ['startDate', 'endDate'],
  },
  requiresApproval: false,
  isIrreversible: false,
  rateLimitPerTenant: 1000,
};

/**
 * Post a journal entry to the ledger
 */
export const postJournalEntryTool: ToolDefinition = {
  name: 'post_journal_entry',
  description: 'Post a double-entry journal entry to the ledger. This creates debit and credit entries that must balance.',
  parameters: {
    type: 'object',
    properties: {
      entries: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            accountCode: { type: 'string', description: 'Account code' },
            accountName: { type: 'string', description: 'Account name' },
            debitAmount: { type: 'number', description: 'Debit amount (0 if credit entry)' },
            creditAmount: { type: 'number', description: 'Credit amount (0 if debit entry)' },
            description: { type: 'string', description: 'Entry description' },
            transactionDate: { type: 'string', format: 'date', description: 'Transaction date' },
          },
          required: ['accountCode', 'accountName', 'description', 'transactionDate'],
        },
        description: 'Array of ledger entries (must balance)',
      },
      description: {
        type: 'string',
        description: 'Overall description for the journal entry',
      },
    },
    required: ['entries', 'description'],
  },
  requiresApproval: true,
  isIrreversible: false,
  rateLimitPerTenant: 100,
};

/**
 * Calculate tax for a transaction
 */
export const calculateTaxTool: ToolDefinition = {
  name: 'calculate_tax',
  description: 'Calculate tax amount and rate for a transaction based on jurisdiction and transaction details. Returns tax rate, amount, and the rule applied.',
  parameters: {
    type: 'object',
    properties: {
      jurisdiction: {
        type: 'string',
        description: 'Jurisdiction code (e.g., "GB", "US-CA")',
      },
      amount: {
        type: 'number',
        description: 'Transaction amount',
      },
      category: {
        type: 'string',
        description: 'Transaction category (optional)',
      },
      description: {
        type: 'string',
        description: 'Transaction description (optional)',
      },
      vendor: {
        type: 'string',
        description: 'Vendor name (optional)',
      },
    },
    required: ['jurisdiction', 'amount'],
  },
  requiresApproval: false,
  isIrreversible: false,
  rateLimitPerTenant: 500,
};

/**
 * Get reconciliation status
 */
export const getReconciliationStatusTool: ToolDefinition = {
  name: 'get_reconciliation_status',
  description: 'Get the reconciliation status for accounts, showing matched and unmatched transactions.',
  parameters: {
    type: 'object',
    properties: {
      accountCode: {
        type: 'string',
        description: 'Account code to check reconciliation status for',
      },
      startDate: {
        type: 'string',
        format: 'date',
        description: 'Start date for reconciliation period (optional)',
      },
      endDate: {
        type: 'string',
        format: 'date',
        description: 'End date for reconciliation period (optional)',
      },
    },
    required: ['accountCode'],
  },
  requiresApproval: false,
  isIrreversible: false,
  rateLimitPerTenant: 200,
};

/**
 * Generate filing draft
 */
export const generateFilingDraftTool: ToolDefinition = {
  name: 'generate_filing_draft',
  description: 'Generate a draft tax filing (VAT, corporation tax, etc.) for a specific period. This creates a draft that must be reviewed and approved before submission.',
  parameters: {
    type: 'object',
    properties: {
      filingType: {
        type: 'string',
        enum: ['vat', 'paye', 'corporation_tax', 'income_tax'],
        description: 'Type of filing to generate',
      },
      jurisdiction: {
        type: 'string',
        description: 'Jurisdiction code (e.g., "GB", "US-CA")',
      },
      periodStart: {
        type: 'string',
        format: 'date',
        description: 'Period start date (YYYY-MM-DD)',
      },
      periodEnd: {
        type: 'string',
        format: 'date',
        description: 'Period end date (YYYY-MM-DD)',
      },
    },
    required: ['filingType', 'jurisdiction', 'periodStart', 'periodEnd'],
  },
  requiresApproval: true,
  isIrreversible: false,
  rateLimitPerTenant: 50,
};

/**
 * Initiate filing submission
 */
export const initiateFilingSubmissionTool: ToolDefinition = {
  name: 'initiate_filing_submission',
  description: 'Submit a filing to the tax authority (e.g., HMRC). This is an irreversible action that requires dual confirmation.',
  parameters: {
    type: 'object',
    properties: {
      filingId: {
        type: 'string',
        format: 'uuid',
        description: 'ID of the filing to submit',
      },
    },
    required: ['filingId'],
  },
  requiresApproval: true,
  isIrreversible: true,
  rateLimitPerTenant: 10,
};

/**
 * Get rule explanation
 */
export const getRuleExplanationTool: ToolDefinition = {
  name: 'get_rule_explanation',
  description: 'Get detailed explanation of a tax rule including its conditions, actions, and examples.',
  parameters: {
    type: 'object',
    properties: {
      jurisdiction: {
        type: 'string',
        description: 'Jurisdiction code',
      },
      ruleId: {
        type: 'string',
        description: 'Rule ID to explain',
      },
    },
    required: ['jurisdiction', 'ruleId'],
  },
  requiresApproval: false,
  isIrreversible: false,
  rateLimitPerTenant: 200,
};

/**
 * All available tools
 */
export const ALL_TOOLS: ToolDefinition[] = [
  getLedgerSliceTool,
  postJournalEntryTool,
  calculateTaxTool,
  getReconciliationStatusTool,
  generateFilingDraftTool,
  initiateFilingSubmissionTool,
  getRuleExplanationTool,
];

/**
 * Convert tool definitions to OpenAI function calling format
 */
export function toolsToOpenAIFormat(): ChatCompletionTool[] {
  return ALL_TOOLS.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Get tool definition by name
 */
export function getToolDefinition(toolName: string): ToolDefinition | undefined {
  return ALL_TOOLS.find(t => t.name === toolName);
}
