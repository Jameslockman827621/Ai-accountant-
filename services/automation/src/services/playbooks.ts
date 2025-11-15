import { db } from '@ai-accountant/database';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { createReviewTask } from '@ai-accountant/workflow-service/services/reviewWorkflow';
import { sendEmail } from '@ai-accountant/notification-service/services/email';

const logger = createLogger('automation-service');

export type PlaybookStatus = 'draft' | 'active' | 'paused';
export type PlaybookRunStatus = 'success' | 'failed' | 'skipped' | 'awaiting_approval';

export interface PlaybookTemplateField {
  key: string;
  label: string;
  type: 'number';
  min?: number;
  max?: number;
  step?: number;
  helperText?: string;
}

export interface PlaybookTemplate {
  key: string;
  name: string;
  description: string;
  category: 'cashflow' | 'compliance';
  triggerType: 'schedule' | 'event';
  cadenceMinutes: number;
  defaultConfig: Record<string, number>;
  configFields: PlaybookTemplateField[];
  confirmationRequired?: boolean;
  metrics: string[];
  callToAction: string;
}

export interface AutomationPlaybook {
  id: string;
  tenantId: TenantId;
  templateKey: string;
  name: string;
  description: string | null;
  status: PlaybookStatus;
  config: Record<string, unknown>;
  cadenceMinutes: number;
  confirmationRequired: boolean;
  lastRunAt: string | null;
  lastRunStatus: PlaybookRunStatus | null;
  lastRunSummary: Record<string, unknown>;
  pendingApprovals: number;
}

export interface PlaybookRun {
  id: string;
  status: PlaybookRunStatus;
  triggeredBy: string;
  message: string | null;
  context: Record<string, unknown>;
  actionSummary: Record<string, unknown>;
  createdAt: string;
  completedAt: string | null;
}

interface PlaybookEvaluation {
  matches: PlaybookMatch[];
  summary: Record<string, unknown>;
}

interface PlaybookMatch {
  id: string;
  reference: string;
  amount?: number;
  date?: string;
  metadata?: Record<string, unknown>;
}

interface CreatePlaybookInput {
  templateKey: string;
  name?: string;
  description?: string;
  config?: Record<string, unknown>;
  cadenceMinutes?: number;
  confirmationRequired?: boolean;
  status?: PlaybookStatus;
}

interface UpdatePlaybookInput {
  status?: PlaybookStatus;
  config?: Record<string, unknown>;
  cadenceMinutes?: number;
  confirmationRequired?: boolean;
}

interface RunOptions {
  triggeredBy: string;
  force?: boolean;
  evaluation?: PlaybookEvaluation;
}

const PLAYBOOK_TEMPLATES: PlaybookTemplate[] = [
  {
    key: 'reconciliation_backlog',
    name: 'Reconciliation Backlog Escalation',
    description: 'Monitor unreconciled transactions and auto-create review tasks when the backlog grows beyond your tolerance.',
    category: 'cashflow',
    triggerType: 'schedule',
    cadenceMinutes: 360,
    defaultConfig: {
      threshold: 10,
      maxAgeDays: 5,
      reviewSample: 15,
      maxActions: 5,
    },
    configFields: [
      {
        key: 'threshold',
        label: 'Minimum unreconciled items before alert',
        type: 'number',
        min: 1,
        max: 200,
        helperText: 'Playbook only triggers when pending items exceed this number.',
      },
      {
        key: 'maxAgeDays',
        label: 'Days before a transaction is considered stale',
        type: 'number',
        min: 1,
        max: 30,
      },
      {
        key: 'maxActions',
        label: 'Max review tasks to create per run',
        type: 'number',
        min: 1,
        max: 25,
      },
    ],
    metrics: ['Pending bank transactions', 'Average age of unreconciled items'],
    callToAction: 'Creates review tasks for the oldest high-priority transactions and emails the finance owner.',
  },
  {
    key: 'filing_deadline_guard',
    name: 'Filing Deadline Guard',
    description: 'Daily sweep for VAT/PAYE/CT filings due soon or overdue, with reminders and optional tasks.',
    category: 'compliance',
    triggerType: 'schedule',
    cadenceMinutes: 1440,
    defaultConfig: {
      daysAhead: 14,
      createTasksForOverdue: 1,
    },
    configFields: [
      {
        key: 'daysAhead',
        label: 'Alert window (days before due date)',
        type: 'number',
        min: 1,
        max: 60,
      },
    ],
    confirmationRequired: true,
    metrics: ['Upcoming filings', 'Overdue filings'],
    callToAction: 'Emails the compliance owner with due filings and prepares review tasks for overdue items once approved.',
  },
];

export function listPlaybookTemplates(): PlaybookTemplate[] {
  return PLAYBOOK_TEMPLATES;
}

function getTemplate(key: string): PlaybookTemplate | undefined {
  return PLAYBOOK_TEMPLATES.find(template => template.key === key);
}

export async function listPlaybooks(tenantId: TenantId): Promise<AutomationPlaybook[]> {
  const result = await db.query<{
    id: string;
    tenant_id: string;
    template_key: string;
    name: string;
    description: string | null;
    status: PlaybookStatus;
    config: Record<string, unknown>;
    cadence_minutes: number;
    confirmation_required: boolean;
    last_run_at: Date | null;
    last_run_status: PlaybookRunStatus | null;
    last_run_summary: Record<string, unknown>;
    pending_approvals: number;
  }>(
    `SELECT p.*,
            COALESCE(pending.count, 0) AS pending_approvals
     FROM automation_playbooks p
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS count
       FROM automation_playbook_runs r
       WHERE r.playbook_id = p.id AND r.status = 'awaiting_approval'
     ) AS pending ON TRUE
     WHERE p.tenant_id = $1
     ORDER BY p.created_at DESC`,
    [tenantId]
  );

  return result.rows.map(mapPlaybookRow);
}

export async function getPlaybook(
  tenantId: TenantId,
  playbookId: string
): Promise<AutomationPlaybook | null> {
  const rows = await db.query<{
    id: string;
    tenant_id: string;
    template_key: string;
    name: string;
    description: string | null;
    status: PlaybookStatus;
    config: Record<string, unknown>;
    cadence_minutes: number;
    confirmation_required: boolean;
    last_run_at: Date | null;
    last_run_status: PlaybookRunStatus | null;
    last_run_summary: Record<string, unknown>;
    pending_approvals: number;
  }>(
    `SELECT p.*,
            COALESCE(pending.count, 0) AS pending_approvals
     FROM automation_playbooks p
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS count
       FROM automation_playbook_runs r
       WHERE r.playbook_id = p.id AND r.status = 'awaiting_approval'
     ) AS pending ON TRUE
     WHERE p.tenant_id = $1 AND p.id = $2`,
    [tenantId, playbookId]
  );

  if (rows.rows.length === 0) {
    return null;
  }
  return mapPlaybookRow(rows.rows[0]);
}

export async function createPlaybook(
  tenantId: TenantId,
  userId: UserId,
  input: CreatePlaybookInput
): Promise<AutomationPlaybook> {
  const template = getTemplate(input.templateKey);
  if (!template) {
    throw new ValidationError('Unknown playbook template');
  }

  const mergedConfig = {
    ...template.defaultConfig,
    ...(input.config || {}),
  };

  const cadenceMinutes = input.cadenceMinutes ?? template.cadenceMinutes;
  const confirmationRequired = input.confirmationRequired ?? Boolean(template.confirmationRequired);
  const status: PlaybookStatus = input.status || 'active';

  const insert = await db.query<{
    id: string;
  }>(
    `INSERT INTO automation_playbooks (
        tenant_id, template_key, name, description, status, config,
        cadence_minutes, confirmation_required, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
      RETURNING id`,
    [
      tenantId,
      template.key,
      input.name || template.name,
      input.description || template.description,
      status,
      JSON.stringify(mergedConfig),
      cadenceMinutes,
      confirmationRequired,
      userId,
    ]
  );

  const created = await getPlaybook(tenantId, insert.rows[0].id);
  if (!created) {
    throw new Error('Failed to load created playbook');
  }
  return created;
}

export async function updatePlaybook(
  tenantId: TenantId,
  playbookId: string,
  updates: UpdatePlaybookInput
): Promise<AutomationPlaybook> {
  const playbook = await getPlaybook(tenantId, playbookId);
  if (!playbook) {
    throw new ValidationError('Playbook not found');
  }

  const template = getTemplate(playbook.templateKey);
  if (!template) {
    throw new ValidationError('Template metadata missing for playbook');
  }

  const mergedConfig =
    updates.config !== undefined
      ? {
          ...template.defaultConfig,
          ...playbook.config,
          ...updates.config,
        }
      : playbook.config;

  await db.query(
    `UPDATE automation_playbooks
     SET status = COALESCE($1, status),
         config = COALESCE($2::jsonb, config),
         cadence_minutes = COALESCE($3, cadence_minutes),
         confirmation_required = COALESCE($4, confirmation_required),
         updated_at = NOW()
     WHERE id = $5 AND tenant_id = $6`,
    [
      updates.status ?? null,
      updates.config ? JSON.stringify(mergedConfig) : null,
      updates.cadenceMinutes ?? null,
      updates.confirmationRequired ?? null,
      playbookId,
      tenantId,
    ]
  );

  const refreshed = await getPlaybook(tenantId, playbookId);
  if (!refreshed) {
    throw new Error('Failed to refresh playbook');
  }
  return refreshed;
}

export async function listPlaybookRuns(
  tenantId: TenantId,
  playbookId: string,
  limit: number = 10
): Promise<PlaybookRun[]> {
  const result = await db.query<{
    id: string;
    status: PlaybookRunStatus;
    triggered_by: string;
    message: string | null;
    context: Record<string, unknown>;
    action_summary: Record<string, unknown>;
    created_at: Date;
    completed_at: Date | null;
  }>(
    `SELECT *
     FROM automation_playbook_runs
     WHERE tenant_id = $1 AND playbook_id = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [tenantId, playbookId, limit]
  );

  return result.rows.map(mapRunRow);
}

export async function runPlaybookById(
  tenantId: TenantId,
  playbookId: string,
  options: RunOptions
): Promise<PlaybookRun> {
  const playbook = await getPlaybook(tenantId, playbookId);
  if (!playbook) {
    throw new ValidationError('Playbook not found');
  }

  return runPlaybook(playbook, options);
}

export async function confirmPlaybookRun(
  tenantId: TenantId,
  playbookId: string,
  runId: string,
  userId: UserId
): Promise<PlaybookRun> {
  const run = await db.query<{
    id: string;
    playbook_id: string;
    tenant_id: string;
    status: PlaybookRunStatus;
    triggered_by: string;
    message: string | null;
    context: Record<string, unknown>;
    action_summary: Record<string, unknown>;
    created_at: Date;
    completed_at: Date | null;
  }>(
    `SELECT * FROM automation_playbook_runs
     WHERE id = $1 AND playbook_id = $2 AND tenant_id = $3`,
    [runId, playbookId, tenantId]
  );

  const row = run.rows[0];
  if (!row) {
    throw new ValidationError('Run not found');
  }
  if (row.status !== 'awaiting_approval') {
    throw new ValidationError('Run already finalized');
  }

  const playbook = await getPlaybook(tenantId, playbookId);
  if (!playbook) {
    throw new ValidationError('Playbook not found');
  }

  const evaluation: PlaybookEvaluation = {
    matches: (row.context.matches as PlaybookMatch[]) || [],
    summary: (row.context.summary as Record<string, unknown>) || {},
  };

  const result = await executeTemplateActions(playbook, evaluation, {
    triggeredBy: `user:${userId}`,
    force: true,
    evaluation,
  });

  await db.query(
    `UPDATE automation_playbook_runs
     SET status = $1,
         action_summary = $2::jsonb,
         message = $3,
         completed_at = NOW()
     WHERE id = $4`,
    ['success', JSON.stringify(result.actionSummary), 'Actions approved', runId]
  );

  await db.query(
    `UPDATE automation_playbooks
     SET last_run_at = NOW(),
         last_run_status = 'success',
         last_run_summary = $2::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [playbook.id, JSON.stringify(result.actionSummary)]
  );

  const updated = await db.query(
    `SELECT * FROM automation_playbook_runs WHERE id = $1`,
    [runId]
  );

  return mapRunRow(updated.rows[0]);
}

export async function runDuePlaybooks(): Promise<void> {
  const result = await db.query<{
    id: string;
    tenant_id: string;
    template_key: string;
    config: Record<string, unknown>;
    cadence_minutes: number;
    confirmation_required: boolean;
    last_run_at: Date | null;
    status: PlaybookStatus;
  }>(
    `SELECT *
     FROM automation_playbooks
     WHERE status = 'active'`
  );

  const now = Date.now();

  for (const row of result.rows) {
    const template = getTemplate(row.template_key);
    if (!template) {
      logger.warn('Skipping playbook without template metadata', { playbookId: row.id });
      continue;
    }

    const cadence = row.cadence_minutes || template.cadenceMinutes;
    const lastRunAt = row.last_run_at ? row.last_run_at.getTime() : 0;
    const nextRunDue = lastRunAt + cadence * 60 * 1000;
    if (lastRunAt !== 0 && nextRunDue > now) {
      continue;
    }

    try {
      await runPlaybook(
        {
          id: row.id,
          tenantId: row.tenant_id as TenantId,
          templateKey: row.template_key,
          name: template.name,
          description: template.description,
          status: 'active',
          config: row.config,
          cadenceMinutes: cadence,
          confirmationRequired: row.confirmation_required,
          lastRunAt: row.last_run_at ? row.last_run_at.toISOString() : null,
          lastRunStatus: null,
          lastRunSummary: {},
          pendingApprovals: 0,
        },
        { triggeredBy: 'scheduler' }
      );
    } catch (error) {
      logger.error('Scheduled playbook run failed', {
        playbookId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function runPlaybook(
  playbook: AutomationPlaybook,
  options: RunOptions
): Promise<PlaybookRun> {
  const template = getTemplate(playbook.templateKey);
  if (!template) {
    throw new ValidationError('Template metadata missing');
  }

  const evaluation =
    options.evaluation ||
    (await evaluateTemplate(playbook.templateKey, playbook.tenantId, playbook.config, playbook));

  const threshold =
    Number(playbook.config.threshold ?? template.defaultConfig.threshold ?? 1);

  if (evaluation.matches.length < threshold) {
    return recordPlaybookRun(playbook, {
      status: 'skipped',
      triggeredBy: options.triggeredBy,
      context: {
        summary: evaluation.summary,
        matches: evaluation.matches.slice(0, 5),
      },
      actionSummary: { reason: 'threshold_not_met' },
      message: `Only ${evaluation.matches.length} matches, below threshold of ${threshold}`,
      completed: true,
    });
  }

  if (playbook.confirmationRequired && !options.force) {
    logger.info('Playbook requires approval before executing', {
      playbookId: playbook.id,
    });
    return recordPlaybookRun(playbook, {
      status: 'awaiting_approval',
      triggeredBy: options.triggeredBy,
      context: {
        summary: evaluation.summary,
        matches: evaluation.matches,
      },
      actionSummary: {},
      message: 'Awaiting approval',
      completed: false,
    });
  }

    const result = await executeTemplateActions(playbook, evaluation, options);

  return recordPlaybookRun(playbook, {
    status: 'success',
    triggeredBy: options.triggeredBy,
    context: {
      summary: evaluation.summary,
      matches: evaluation.matches.slice(0, 10),
    },
    actionSummary: result.actionSummary,
    message: result.message,
    completed: true,
  });
}

async function evaluateTemplate(
  templateKey: string,
  tenantId: TenantId,
  config: Record<string, unknown>,
  playbook: AutomationPlaybook
): Promise<PlaybookEvaluation> {
  switch (templateKey) {
    case 'reconciliation_backlog':
      return evaluateReconciliationBacklog(tenantId, playbook.config);
    case 'filing_deadline_guard':
      return evaluateFilingDeadlineGuard(tenantId, playbook.config);
    default:
      throw new ValidationError(`Unknown playbook template: ${templateKey}`);
  }
}

async function executeTemplateActions(
  playbook: AutomationPlaybook,
  evaluation: PlaybookEvaluation,
  options: RunOptions
): Promise<{ actionSummary: Record<string, unknown>; message: string }> {
  switch (playbook.templateKey) {
    case 'reconciliation_backlog':
      return executeReconciliationBacklog(playbook, evaluation, options);
    case 'filing_deadline_guard':
      return executeFilingDeadlineGuard(playbook, evaluation, options);
    default:
      throw new ValidationError(`Unknown playbook template: ${playbook.templateKey}`);
  }
}

async function evaluateReconciliationBacklog(
  tenantId: TenantId,
  config: Record<string, unknown>
): Promise<PlaybookEvaluation> {
  const maxAgeDays = Number(config.maxAgeDays ?? 5);
  const reviewSample = Number(config.reviewSample ?? 15);

  const matchesQuery = await db.query<{
    id: string;
    description: string | null;
    amount: string;
    date: Date;
    currency: string | null;
    updated_at: Date | null;
  }>(
    `SELECT id, description, amount, date, currency, updated_at
     FROM bank_transactions
     WHERE tenant_id = $1
       AND (reconciled IS NULL OR reconciled = false)
       AND date <= NOW() - ($2::int * INTERVAL '1 day')
     ORDER BY date ASC
     LIMIT $3`,
    [tenantId, maxAgeDays, reviewSample]
  );

  const metrics = await db.query<{
    pending: number;
    stale: number;
  }>(
    `SELECT
        COUNT(*) FILTER (WHERE reconciled = false) AS pending,
        COUNT(*) FILTER (
          WHERE reconciled = false AND date <= NOW() - ($2::int * INTERVAL '1 day')
        ) AS stale
     FROM bank_transactions
     WHERE tenant_id = $1`,
    [tenantId, maxAgeDays]
  );

  const summaryRow = metrics.rows[0];

  return {
    matches: matchesQuery.rows.map(row => ({
      id: row.id,
      reference: row.description || 'Bank transaction',
      amount: Number(row.amount),
      date: row.date.toISOString(),
      metadata: {
        currency: row.currency,
        daysOld: Math.floor((Date.now() - row.date.getTime()) / 86_400_000),
      },
    })),
    summary: {
      pending: Number(summaryRow?.pending || 0),
      stale: Number(summaryRow?.stale || 0),
      maxAgeDays,
    },
  };
}

async function executeReconciliationBacklog(
  playbook: AutomationPlaybook,
  evaluation: PlaybookEvaluation,
  options: RunOptions
) {
  const tenantId = playbook.tenantId;
  const maxActions = Number(playbook.config.maxActions ?? 5);
  const matchesToProcess = evaluation.matches.slice(0, maxActions);

  let createdTasks = 0;
  for (const match of matchesToProcess) {
    await createReviewTask(tenantId, 'transaction', match.id, 'high');
    createdTasks += 1;
  }

  let notifiedUsers = 0;
  const contact = await getPrimaryContact(tenantId);
  if (contact?.email) {
    await sendEmail(
      contact.email,
      'Reconciliation backlog requires attention',
      `
        <p>There are ${evaluation.summary.stale} stale unreconciled transactions.</p>
        <p>Top pending item: ${matchesToProcess[0]?.reference ?? 'n/a'}.</p>
        <p>Automation run triggered by ${options.triggeredBy}.</p>
      `
    );
    notifiedUsers = 1;
  }

  return {
    actionSummary: {
      createdTasks,
      notifiedUsers,
    },
    message: `Created ${createdTasks} review tasks`,
  };
}

async function evaluateFilingDeadlineGuard(
  tenantId: TenantId,
  config: Record<string, unknown>
): Promise<PlaybookEvaluation> {
  const daysAhead = Number(config.daysAhead ?? 14);

  const result = await db.query<{
    id: string;
    filing_type: string;
    due_date: Date;
    status: string;
  }>(
    `SELECT id, filing_type, due_date, status
     FROM filings
     WHERE tenant_id = $1
       AND status IN ('draft', 'ready', 'awaiting_submission')
       AND due_date <= NOW() + ($2::int * INTERVAL '1 day')
     ORDER BY due_date ASC`,
    [tenantId, daysAhead]
  );

  const overdue = result.rows.filter(row => row.due_date < new Date());

  return {
    matches: result.rows.map(row => ({
      id: row.id,
      reference: row.filing_type,
      date: row.due_date.toISOString(),
      metadata: {
        status: row.status,
        overdue: row.due_date < new Date(),
      },
    })),
    summary: {
      total: result.rows.length,
      overdue: overdue.length,
      window: daysAhead,
    },
  };
}

async function executeFilingDeadlineGuard(
  playbook: AutomationPlaybook,
  evaluation: PlaybookEvaluation,
  options: RunOptions
) {
  const tenantId = playbook.tenantId;
  const contact = await getPrimaryContact(tenantId);
  let notifiedUsers = 0;
  if (contact?.email) {
    const overdueCount = evaluation.matches.filter(match => match.metadata?.overdue).length;
    await sendEmail(
      contact.email,
      'Upcoming HMRC filings',
      `
        <p>You have ${evaluation.summary.total} filings due within ${evaluation.summary.window} days.</p>
        <p>Overdue filings: ${overdueCount}.</p>
        <p>Triggered by ${options.triggeredBy}.</p>
      `
    );
    notifiedUsers = 1;
  }

  let createdTasks = 0;
  if (Number(playbook.config.createTasksForOverdue ?? 1) === 1) {
    for (const match of evaluation.matches) {
      if (match.metadata?.overdue) {
        await createReviewTask(tenantId, 'filing', match.id, 'high');
        createdTasks += 1;
      }
    }
  }

  return {
    actionSummary: {
      createdTasks,
      notifiedUsers,
    },
    message: `Notified compliance owner and created ${createdTasks} tasks`,
  };
}

async function recordPlaybookRun(
  playbook: AutomationPlaybook,
  params: {
    status: PlaybookRunStatus;
    triggeredBy: string;
    context: Record<string, unknown>;
    actionSummary: Record<string, unknown>;
    message: string;
    completed: boolean;
  }
): Promise<PlaybookRun> {
  const insert = await db.query<{
    id: string;
    status: PlaybookRunStatus;
    triggered_by: string;
    message: string | null;
    context: Record<string, unknown>;
    action_summary: Record<string, unknown>;
    created_at: Date;
    completed_at: Date | null;
  }>(
    `INSERT INTO automation_playbook_runs (
        playbook_id, tenant_id, triggered_by, status, context, action_summary, message, completed_at
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)
      RETURNING *`,
    [
      playbook.id,
      playbook.tenantId,
      params.triggeredBy,
      params.status,
      JSON.stringify(params.context),
      JSON.stringify(params.actionSummary),
      params.message,
      params.completed ? new Date() : null,
    ]
  );

  await db.query(
    `UPDATE automation_playbooks
     SET last_run_at = NOW(),
         last_run_status = $2,
         last_run_summary = $3::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [playbook.id, params.status, JSON.stringify(params.actionSummary)]
  );

  return mapRunRow(insert.rows[0]);
}

function mapPlaybookRow(row: {
  id: string;
  tenant_id: string;
  template_key: string;
  name: string;
  description: string | null;
  status: PlaybookStatus;
  config: Record<string, unknown>;
  cadence_minutes: number;
  confirmation_required: boolean;
  last_run_at: Date | null;
  last_run_status: PlaybookRunStatus | null;
  last_run_summary: Record<string, unknown>;
  pending_approvals: number;
}): AutomationPlaybook {
  return {
    id: row.id,
    tenantId: row.tenant_id as TenantId,
    templateKey: row.template_key,
    name: row.name,
    description: row.description,
    status: row.status,
    config: row.config || {},
    cadenceMinutes: row.cadence_minutes,
    confirmationRequired: row.confirmation_required,
    lastRunAt: row.last_run_at ? row.last_run_at.toISOString() : null,
    lastRunStatus: row.last_run_status,
    lastRunSummary: row.last_run_summary || {},
    pendingApprovals: Number(row.pending_approvals || 0),
  };
}

function mapRunRow(row: {
  id: string;
  status: PlaybookRunStatus;
  triggered_by: string;
  message: string | null;
  context: Record<string, unknown>;
  action_summary: Record<string, unknown>;
  created_at: Date;
  completed_at: Date | null;
}): PlaybookRun {
  return {
    id: row.id,
    status: row.status,
    triggeredBy: row.triggered_by,
    message: row.message,
    context: row.context || {},
    actionSummary: row.action_summary || {},
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
  };
}

async function getPrimaryContact(
  tenantId: TenantId
): Promise<{ email: string | null; name: string | null } | null> {
  const result = await db.query<{ email: string; name: string | null }>(
    `SELECT u.email, t.name
     FROM users u
     JOIN tenants t ON t.id = u.tenant_id
     WHERE u.tenant_id = $1
     ORDER BY (u.role = 'owner') DESC, u.created_at ASC
     LIMIT 1`,
    [tenantId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return { email: row.email, name: row.name };
}
