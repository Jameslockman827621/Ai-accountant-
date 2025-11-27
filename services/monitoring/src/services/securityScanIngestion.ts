import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { createAlertFromFinding } from '../alerting';

const logger = createLogger('monitoring-service');

export interface SecurityScanFinding {
  tool: 'sast' | 'dast' | 'dependency';
  summary: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  reference?: string;
  tenantId?: string;
}

export async function recordSecurityFindings(findings: SecurityScanFinding[]): Promise<void> {
  for (const finding of findings) {
    await db.query(
      `INSERT INTO security_findings (tool, summary, severity, reference, tenant_id, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT DO NOTHING`,
      [finding.tool, finding.summary, finding.severity, finding.reference || null, finding.tenantId || null]
    ).catch(error => logger.error('Failed to persist security finding', error));

    await createAlertFromFinding({
      tool: finding.tool,
      severity: finding.severity,
      summary: finding.summary,
      tenantId: finding.tenantId,
    });
  }
}
