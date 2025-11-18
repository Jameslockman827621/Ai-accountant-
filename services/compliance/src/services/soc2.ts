import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { UserId } from '@ai-accountant/shared-types';

const logger = createLogger('compliance-service');

export interface SOC2Control {
  id: string;
  name: string;
  description: string;
  category: 'CC1' | 'CC2' | 'CC3' | 'CC4' | 'CC5' | 'CC6' | 'CC7';
  status: 'implemented' | 'partial' | 'not_implemented';
  evidence: string[];
  lastReviewed: Date | null;
}

export const SOC2_CONTROLS: SOC2Control[] = [
  {
    id: 'CC1.1',
    name: 'Control Environment',
    description: 'Entity demonstrates commitment to integrity and ethical values',
    category: 'CC1',
    status: 'implemented',
    evidence: ['Code of conduct', 'Ethics training'],
    lastReviewed: new Date(),
  },
  {
    id: 'CC2.1',
    name: 'Communication and Information',
    description: 'Entity obtains or generates and uses relevant, quality information',
    category: 'CC2',
    status: 'implemented',
    evidence: ['Data quality controls', 'Information systems'],
    lastReviewed: new Date(),
  },
  {
    id: 'CC3.1',
    name: 'Risk Assessment',
    description: 'Entity specifies suitable objectives',
    category: 'CC3',
    status: 'implemented',
    evidence: ['Risk assessment process', 'Risk register'],
    lastReviewed: new Date(),
  },
  {
    id: 'CC4.1',
    name: 'Monitoring Activities',
    description: 'Entity selects and develops control activities',
    category: 'CC4',
    status: 'implemented',
    evidence: ['Control monitoring', 'Audit logs'],
    lastReviewed: new Date(),
  },
  {
    id: 'CC5.1',
    name: 'Control Activities',
    description: 'Entity deploys control activities through policies and procedures',
    category: 'CC5',
    status: 'implemented',
    evidence: ['Access controls', 'Change management'],
    lastReviewed: new Date(),
  },
  {
    id: 'CC6.1',
    name: 'Logical and Physical Access',
    description: 'Entity implements logical access security software',
    category: 'CC6',
    status: 'implemented',
    evidence: ['Authentication', 'Authorization', 'Encryption'],
    lastReviewed: new Date(),
  },
  {
    id: 'CC7.1',
    name: 'System Operations',
    description: 'Entity implements detection and monitoring procedures',
    category: 'CC7',
    status: 'implemented',
    evidence: ['Monitoring systems', 'Alerting'],
    lastReviewed: new Date(),
  },
];

export async function getSOC2Controls(): Promise<SOC2Control[]> {
  // In production, fetch from database
  return SOC2_CONTROLS;
}

export async function recordControlEvidence(
  controlId: string,
  evidence: string,
  reviewedBy: UserId
): Promise<void> {
  await db.query(
    `INSERT INTO soc2_evidence (control_id, evidence, reviewed_by, reviewed_at)
     VALUES ($1, $2, $3, NOW())`,
    [controlId, evidence, reviewedBy]
  );

  logger.info('SOC2 evidence recorded', { controlId, reviewedBy });
}

export async function getControlEvidence(controlId: string): Promise<Array<{
  evidence: string;
  reviewedBy: string;
  reviewedAt: Date;
}>> {
  const result = await db.query<{
    evidence: string;
    reviewed_by: string;
    reviewed_at: Date;
  }>(
    'SELECT evidence, reviewed_by, reviewed_at FROM soc2_evidence WHERE control_id = $1 ORDER BY reviewed_at DESC',
    [controlId]
  );

  return result.rows.map(row => ({
    evidence: row.evidence,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
  }));
}
