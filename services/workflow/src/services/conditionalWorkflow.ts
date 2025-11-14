import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('workflow-service');

export interface ConditionalWorkflow {
  id: string;
  tenantId: TenantId;
  name: string;
  description: string;
  triggers: WorkflowTrigger[];
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
  isActive: boolean;
}

export interface WorkflowTrigger {
  type: 'event' | 'schedule' | 'condition';
  event?: string;
  schedule?: string; // cron expression
  condition?: string; // expression
}

export interface WorkflowCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains' | 'in';
  value: unknown;
  logicalOperator?: 'AND' | 'OR';
}

export interface WorkflowAction {
  type: 'notify' | 'create_task' | 'update_status' | 'call_api' | 'execute_script';
  parameters: Record<string, unknown>;
}

/**
 * Execute conditional workflow
 */
export async function executeConditionalWorkflow(
  workflowId: string,
  context: Record<string, unknown>
): Promise<boolean> {
  const workflow = await getWorkflow(workflowId);
  if (!workflow || !workflow.isActive) {
    return false;
  }

  // Evaluate conditions
  const conditionsMet = evaluateConditions(workflow.conditions, context);
  if (!conditionsMet) {
    logger.debug('Workflow conditions not met', { workflowId });
    return false;
  }

  // Execute actions
  for (const action of workflow.actions) {
    await executeWorkflowAction(action, context, workflow.tenantId);
  }

  logger.info('Workflow executed', { workflowId });
  return true;
}

function evaluateConditions(
  conditions: WorkflowCondition[],
  context: Record<string, unknown>
): boolean {
  if (conditions.length === 0) return true;

  let result = evaluateCondition(conditions[0], context);
  let lastOperator: 'AND' | 'OR' = 'AND';

  for (let i = 1; i < conditions.length; i++) {
    const condition = conditions[i];
    const conditionResult = evaluateCondition(condition, context);

    if (lastOperator === 'AND') {
      result = result && conditionResult;
    } else {
      result = result || conditionResult;
    }

    lastOperator = condition.logicalOperator || 'AND';
  }

  return result;
}

function evaluateCondition(
  condition: WorkflowCondition,
  context: Record<string, unknown>
): boolean {
  const fieldValue = context[condition.field];

  switch (condition.operator) {
    case 'equals':
      return fieldValue === condition.value;
    case 'not_equals':
      return fieldValue !== condition.value;
    case 'greater_than':
      return typeof fieldValue === 'number' && typeof condition.value === 'number' && fieldValue > condition.value;
    case 'less_than':
      return typeof fieldValue === 'number' && typeof condition.value === 'number' && fieldValue < condition.value;
    case 'contains':
      return typeof fieldValue === 'string' && typeof condition.value === 'string' && fieldValue.includes(condition.value);
    case 'in':
      return Array.isArray(condition.value) && condition.value.includes(fieldValue);
    default:
      return false;
  }
}

async function executeWorkflowAction(
  action: WorkflowAction,
  context: Record<string, unknown>,
  tenantId: TenantId
): Promise<void> {
  switch (action.type) {
    case 'notify':
      // Send notification
      logger.info('Workflow notification', { parameters: action.parameters });
      break;
    case 'create_task':
      await db.query(
        `INSERT INTO review_tasks (id, tenant_id, type, entity_id, status, priority, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 'pending', $4, NOW())`,
        [
          tenantId,
          action.parameters.entityType,
          action.parameters.entityId,
          action.parameters.priority || 'medium',
        ]
      );
      break;
    case 'update_status':
      // Update entity status
      logger.info('Workflow status update', { parameters: action.parameters });
      break;
    case 'call_api':
      // Call external API
      logger.info('Workflow API call', { parameters: action.parameters });
      break;
    case 'execute_script':
      // Execute custom script
      logger.info('Workflow script execution', { parameters: action.parameters });
      break;
  }
}

async function getWorkflow(workflowId: string): Promise<ConditionalWorkflow | null> {
  const result = await db.query<{
    id: string;
    tenant_id: string;
    name: string;
    description: string;
    triggers: unknown;
    conditions: unknown;
    actions: unknown;
    is_active: boolean;
  }>(
    'SELECT * FROM conditional_workflows WHERE id = $1',
    [workflowId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description,
    triggers: row.triggers as WorkflowTrigger[],
    conditions: row.conditions as WorkflowCondition[],
    actions: row.actions as WorkflowAction[],
    isActive: row.is_active,
  };
}
