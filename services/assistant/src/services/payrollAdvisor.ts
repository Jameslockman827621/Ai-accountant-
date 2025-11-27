import { db } from '@ai-accountant/database';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';
import OpenAI from 'openai';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('assistant-service');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface PayrollGuidanceRequest {
  payDate: string;
  payPeriodEnd: string;
  country: string;
  jurisdiction?: string;
  payRunId?: string;
}

export interface PayrollGuidanceResponse {
  complianceFindings: Array<{
    ruleId: string;
    severity: 'info' | 'warning' | 'error';
    description: string;
    remediation: string;
  }>;
  localizedChecklist: Array<{
    title: string;
    required: boolean;
    status: 'pending' | 'complete' | 'blocked';
    detail?: string;
  }>;
  llmSummary?: string;
}

export async function getPayrollGuidance(
  tenantId: TenantId,
  payload: PayrollGuidanceRequest
): Promise<PayrollGuidanceResponse> {
  if (!payload.country) {
    throw new ValidationError('Country is required for payroll guidance');
  }

  const compliance = await db.query<{ rule_id: string; severity: string; description: string; remediation: string }>(
    `SELECT rule_id, severity, description, remediation
       FROM compliance_findings
      WHERE tenant_id = $1
        AND domain = 'payroll'
        AND jurisdiction = $2
      ORDER BY created_at DESC
      LIMIT 20`,
    [tenantId, payload.jurisdiction || payload.country]
  );

  const localizedChecklist = await db.query<{ title: string; required: boolean; detail?: string; status?: string }>(
    `SELECT title, required, detail, status
       FROM compliance_checklist
      WHERE tenant_id = $1
        AND domain = 'payroll'
        AND (jurisdiction = $2 OR jurisdiction IS NULL)
      ORDER BY priority DESC
      LIMIT 20`,
    [tenantId, payload.jurisdiction || payload.country]
  );

  const findings = compliance.rows.length
    ? compliance.rows.map(row => ({
        ruleId: row.rule_id,
        severity: (row.severity as 'info' | 'warning' | 'error') || 'info',
        description: row.description,
        remediation: row.remediation,
      }))
    : [
        {
          ruleId: 'withholding-filing',
          severity: 'warning',
          description: 'Ensure PAYE/withholding submission is queued for this pay date.',
          remediation: 'Submit RTI/withholding files with gross-to-net totals and remittance references.',
        },
      ];

  const checklist = localizedChecklist.rows.length
    ? localizedChecklist.rows.map(item => ({
        title: item.title,
        required: item.required,
        status: (item.status as 'pending' | 'complete' | 'blocked') || 'pending',
        detail: item.detail || undefined,
      }))
    : [
        {
          title: 'Validate payment file (SEPA/ACH/BACS)',
          required: true,
          status: 'pending',
          detail: 'Check bank formats, duplicate payees, and funding limits.',
        },
        {
          title: 'Reconcile employer taxes vs payroll journal',
          required: true,
          status: 'pending',
        },
      ];

  let llmSummary: string | undefined;
  if (process.env.OPENAI_API_KEY) {
    try {
      const prompt = `Provide localized payroll compliance guidance for ${payload.jurisdiction || payload.country}.
      Pay date: ${payload.payDate}. Period end: ${payload.payPeriodEnd}. Findings:
      ${findings.map(f => `${f.ruleId} (${f.severity}): ${f.description}`).join('\n')}

      Checklist:
      ${checklist.map(item => `${item.required ? '[required]' : '[optional]'} ${item.title} - ${item.status}`).join('\n')}

      Keep response under 120 words and focus on immediate actions.`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        messages: [
          { role: 'system', content: 'You are a payroll compliance assistant who is precise and concise.' },
          { role: 'user', content: prompt },
        ],
      });

      llmSummary = completion.choices[0]?.message?.content || undefined;
    } catch (error) {
      logger.warn('LLM payroll guidance failed, returning structured data', error as Error);
    }
  }

  return { complianceFindings: findings, localizedChecklist: checklist, llmSummary };
}
