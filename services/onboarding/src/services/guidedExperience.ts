import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';

const logger = createLogger('onboarding-service');

export interface GuidedTourStep {
  id: string;
  title: string;
  description: string;
  helpArticleId?: string;
}

export interface GuidedTour {
  id: string;
  title: string;
  description: string;
  steps: GuidedTourStep[];
  completedSteps: string[];
  completion: number;
}

export interface GuidedChecklistItem {
  id: string;
  title: string;
  description: string;
  helpArticleId?: string;
}

export interface GuidedChecklist {
  id: string;
  title: string;
  summary: string;
  items: GuidedChecklistItem[];
  completedItemIds: string[];
  completion: number;
}

export interface SampleDatasetTask {
  id: string;
  title: string;
  description: string;
  helpArticleId?: string;
}

export interface SampleDataset {
  id: string;
  name: string;
  industry: string;
  records: number;
  description: string;
  tasks: SampleDatasetTask[];
  completedTaskIds: string[];
  completion: number;
}

interface GuidedExperienceState {
  tours: Record<string, string[]>;
  checklists: Record<string, string[]>;
  datasets: Record<string, string[]>;
}

const STORAGE_KEY = 'guided_experience';

const DEFAULT_STATE: GuidedExperienceState = {
  tours: {},
  checklists: {},
  datasets: {},
};

const GETTING_STARTED_TOURS: Array<Pick<GuidedTour, 'id' | 'title' | 'description' | 'steps'>> = [
  {
    id: 'getting-started',
    title: 'Getting started tour',
    description: 'Step-by-step orientation through the most important workflows.',
    steps: [
      {
        id: 'connect-bank',
        title: 'Connect your first bank feed',
        description: 'Link a bank or accounting connector so transactions flow automatically.',
        helpArticleId: 'kb-bank-connections',
      },
      {
        id: 'import-documents',
        title: 'Upload your first receipts',
        description: 'Upload invoices or receipts to see extraction and posting in action.',
        helpArticleId: 'kb-document-ingest',
      },
      {
        id: 'review-ledger',
        title: 'Review the auto-posted ledger',
        description: 'Open the ledger view and confirm how entries were classified.',
        helpArticleId: 'kb-ledger-review',
      },
      {
        id: 'ask-assistant',
        title: 'Ask the copilot a question',
        description: 'Use the assistant to explain variances or to find a transaction.',
        helpArticleId: 'kb-assistant-prompts',
      },
    ],
  },
  {
    id: 'compliance-tour',
    title: 'Compliance readiness',
    description: 'Make sure your workspace is ready for filings and evidence.',
    steps: [
      {
        id: 'complete-profile',
        title: 'Complete business profile',
        description: 'Fill entity type, industry, and jurisdiction for localized rules.',
        helpArticleId: 'kb-onboarding-profile',
      },
      {
        id: 'enable-audit-trail',
        title: 'Enable audit logging',
        description: 'Turn on activity logging for document reviews and approvals.',
        helpArticleId: 'kb-audit-trail',
      },
      {
        id: 'submit-sample-filing',
        title: 'Walk through a sample filing',
        description: 'Generate a mock filing to rehearse approvals and submissions.',
        helpArticleId: 'kb-filing-walkthrough',
      },
    ],
  },
];

const GETTING_STARTED_CHECKLISTS: Array<Pick<GuidedChecklist, 'id' | 'title' | 'summary' | 'items'>> = [
  {
    id: 'workspace-hardening',
    title: 'Workspace hardening checklist',
    summary: 'Quick security and controls checklist for new tenants.',
    items: [
      {
        id: 'mfa',
        title: 'Enable MFA for admins',
        description: 'Require multi-factor authentication for administrator roles.',
        helpArticleId: 'kb-security-mfa',
      },
      {
        id: 'support-access',
        title: 'Set up delegated access',
        description: 'Authorize support escalation contacts with least-privilege roles.',
        helpArticleId: 'kb-support-access',
      },
      {
        id: 'backup-policy',
        title: 'Review backup & retention policy',
        description: 'Confirm backup cadence and retention aligned to your compliance scope.',
        helpArticleId: 'kb-backup-policy',
      },
    ],
  },
  {
    id: 'go-live',
    title: 'Go-live validation',
    summary: 'Final readiness checks before switching on automations.',
    items: [
      {
        id: 'chart-approval',
        title: 'Approve chart of accounts mapping',
        description: 'Validate mapping rules for revenue, expense, and balance sheet accounts.',
        helpArticleId: 'kb-chart-approval',
      },
      {
        id: 'bank-reco',
        title: 'Run first bank reconciliation',
        description: 'Confirm imported transactions match bank statements and rules.',
        helpArticleId: 'kb-bank-reconciliation',
      },
      {
        id: 'evidence-room',
        title: 'Validate evidence collection',
        description: 'Ensure review notes and documents flow into the compliance evidence room.',
        helpArticleId: 'kb-evidence-room',
      },
    ],
  },
];

const SAMPLE_DATASETS: Array<Pick<SampleDataset, 'id' | 'name' | 'industry' | 'records' | 'description' | 'tasks'>> = [
  {
    id: 'retail-demo',
    name: 'Retail demo book',
    industry: 'Retail & ecommerce',
    records: 1250,
    description: 'POS, payment processor, and marketplace feeds with VAT-ready mappings.',
    tasks: [
      {
        id: 'ingest',
        title: 'Ingest dataset',
        description: 'Load transactions and documents to populate the workspace.',
        helpArticleId: 'kb-sample-data',
      },
      {
        id: 'reconcile',
        title: 'Reconcile imported period',
        description: 'Auto-match payouts and fees, then clear reconciliation alerts.',
        helpArticleId: 'kb-reconciliation',
      },
      {
        id: 'file-vat',
        title: 'Generate VAT draft',
        description: 'Create a VAT return draft from the sample period to preview filings.',
        helpArticleId: 'kb-vat-drafts',
      },
    ],
  },
  {
    id: 'consulting-demo',
    name: 'Consulting firm sample',
    industry: 'Professional services',
    records: 420,
    description: 'Time & materials workflow with expense receipts and project tags.',
    tasks: [
      {
        id: 'review-rules',
        title: 'Review classification rules',
        description: 'Inspect automation rules applied to expenses and invoices.',
        helpArticleId: 'kb-automation-rules',
      },
      {
        id: 'generate-report',
        title: 'Generate management report',
        description: 'Use the assistant to assemble a margin and variance report.',
        helpArticleId: 'kb-assistant-reports',
      },
      {
        id: 'close-checklist',
        title: 'Run close checklist',
        description: 'Walk through close tasks using the sample project data.',
        helpArticleId: 'kb-close-checklist',
      },
    ],
  },
];

async function loadState(tenantId: TenantId): Promise<GuidedExperienceState> {
  const result = await db.query<{ step_data: unknown }>(
    'SELECT step_data FROM onboarding_step_data WHERE tenant_id = $1 AND step_name = $2',
    [tenantId, STORAGE_KEY]
  );

  if (result.rows.length === 0) {
    return DEFAULT_STATE;
  }

  const data = result.rows[0].step_data as GuidedExperienceState | null;
  return {
    tours: data?.tours || {},
    checklists: data?.checklists || {},
    datasets: data?.datasets || {},
  };
}

async function saveState(tenantId: TenantId, state: GuidedExperienceState): Promise<void> {
  await db.query(
    `INSERT INTO onboarding_step_data (tenant_id, step_name, step_data, validation_status, is_draft, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, 'valid', false, NOW(), NOW())
     ON CONFLICT (tenant_id, step_name)
     DO UPDATE SET step_data = $3::jsonb, validation_status = 'valid', is_draft = false, updated_at = NOW()`,
    [tenantId, STORAGE_KEY, JSON.stringify(state)]
  );
}

function applyTourProgress(
  state: GuidedExperienceState,
  tours: Array<Pick<GuidedTour, 'id' | 'title' | 'description' | 'steps'>>
): GuidedTour[] {
  return tours.map(tour => {
    const completedSteps = state.tours[tour.id] || [];
    const completion = Math.round((completedSteps.length / tour.steps.length) * 100);

    return {
      ...tour,
      completedSteps,
      completion,
    };
  });
}

function applyChecklistProgress(
  state: GuidedExperienceState,
  checklists: Array<Pick<GuidedChecklist, 'id' | 'title' | 'summary' | 'items'> | GuidedChecklist>
): GuidedChecklist[] {
  return checklists.map(checklist => {
    const completedItemIds = state.checklists[checklist.id] || [];
    const completion = Math.round((completedItemIds.length / checklist.items.length) * 100);

    return {
      ...checklist,
      completedItemIds,
      completion,
    } as GuidedChecklist;
  });
}

function applyDatasetProgress(
  state: GuidedExperienceState,
  datasets: Array<Pick<SampleDataset, 'id' | 'name' | 'industry' | 'records' | 'description' | 'tasks'> | SampleDataset>
): SampleDataset[] {
  return datasets.map(dataset => {
    const completedTaskIds = state.datasets[dataset.id] || [];
    const completion = Math.round((completedTaskIds.length / dataset.tasks.length) * 100);

    return {
      ...dataset,
      completedTaskIds,
      completion,
    } as SampleDataset;
  });
}

export async function getGuidedExperience(tenantId: TenantId): Promise<{
  tours: GuidedTour[];
  checklists: GuidedChecklist[];
  sampleDatasets: SampleDataset[];
}> {
  const state = await loadState(tenantId);

  return {
    tours: applyTourProgress(state, GETTING_STARTED_TOURS),
    checklists: applyChecklistProgress(state, GETTING_STARTED_CHECKLISTS),
    sampleDatasets: applyDatasetProgress(state, SAMPLE_DATASETS),
  };
}

export async function completeTourStep(
  tenantId: TenantId,
  userId: UserId,
  tourId: string,
  stepId: string
): Promise<GuidedTour[]> {
  const state = await loadState(tenantId);
  const completed = new Set(state.tours[tourId] || []);
  completed.add(stepId);

  state.tours[tourId] = Array.from(completed);
  await saveState(tenantId, state);

  logger.info('Guided tour step completed', { tenantId, userId, tourId, stepId });

  return applyTourProgress(state, GETTING_STARTED_TOURS);
}

export async function updateChecklistItem(
  tenantId: TenantId,
  userId: UserId,
  checklistId: string,
  itemId: string,
  completed: boolean
): Promise<GuidedChecklist[]> {
  const state = await loadState(tenantId);
  const completedItems = new Set(state.checklists[checklistId] || []);

  if (completed) {
    completedItems.add(itemId);
  } else {
    completedItems.delete(itemId);
  }

  state.checklists[checklistId] = Array.from(completedItems);
  await saveState(tenantId, state);

  logger.info('Checklist item updated', { tenantId, userId, checklistId, itemId, completed });

  return applyChecklistProgress(state, GETTING_STARTED_CHECKLISTS);
}

export async function completeDatasetTask(
  tenantId: TenantId,
  userId: UserId,
  datasetId: string,
  taskId: string
): Promise<SampleDataset[]> {
  const state = await loadState(tenantId);
  const completedTasks = new Set(state.datasets[datasetId] || []);
  completedTasks.add(taskId);

  state.datasets[datasetId] = Array.from(completedTasks);
  await saveState(tenantId, state);

  logger.info('Sample dataset task completed', { tenantId, userId, datasetId, taskId });

  return applyDatasetProgress(state, SAMPLE_DATASETS);
}
