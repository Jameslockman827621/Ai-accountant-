import { randomUUID } from 'crypto';
import { createServiceLogger } from './logger';

export type DataMutationOperation = 'create' | 'update' | 'delete' | 'access';

export type DataMutationStatus = 'pending' | 'success' | 'error';

export interface DataLineageEvent {
  traceId: string;
  parentTraceId?: string;
  entity: string;
  entityId?: string;
  tenantId?: string;
  actorId?: string;
  operation: DataMutationOperation;
  status: DataMutationStatus;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

interface LineageFilter {
  tenantId?: string;
  entity?: string;
  operation?: DataMutationOperation;
}

const lineageLogger = createServiceLogger('data-lineage');
const MAX_EVENTS = 500;
const lineageHistory: DataLineageEvent[] = [];
const lineageIndex = new Map<string, DataLineageEvent>();

function persistEvent(event: DataLineageEvent): DataLineageEvent {
  lineageIndex.set(event.traceId, event);
  lineageHistory.unshift(event);

  if (lineageHistory.length > MAX_EVENTS) {
    const removed = lineageHistory.pop();
    if (removed) {
      lineageIndex.delete(removed.traceId);
    }
  }

  return event;
}

export function createDataMutationTrace(params: {
  entity: string;
  entityId?: string;
  tenantId?: string;
  actorId?: string;
  operation: DataMutationOperation;
  metadata?: Record<string, unknown>;
  parentTraceId?: string;
  traceId?: string;
}): DataLineageEvent {
  const traceId = params.traceId ?? randomUUID();
  const event: DataLineageEvent = {
    traceId,
    parentTraceId: params.parentTraceId,
    entity: params.entity,
    entityId: params.entityId,
    tenantId: params.tenantId,
    actorId: params.actorId,
    operation: params.operation,
    status: 'pending',
    timestamp: new Date().toISOString(),
    metadata: params.metadata,
  };

  lineageLogger.info('Data mutation traced', {
    traceId,
    entity: params.entity,
    entityId: params.entityId,
    operation: params.operation,
  });

  return persistEvent(event);
}

export function completeDataMutationTrace(
  traceId: string,
  status: DataMutationStatus,
  metadata?: Record<string, unknown>
): DataLineageEvent | undefined {
  const existing = lineageIndex.get(traceId);
  if (!existing) {
    return undefined;
  }

  const updated: DataLineageEvent = {
    ...existing,
    status,
    timestamp: new Date().toISOString(),
    metadata: { ...existing.metadata, ...metadata },
  };

  lineageLogger.info('Data mutation completed', {
    traceId,
    status,
    entity: updated.entity,
    entityId: updated.entityId,
  });

  return persistEvent(updated);
}

export function getLineageEvent(traceId: string): DataLineageEvent | undefined {
  return lineageIndex.get(traceId);
}

export function listLineageEvents(filter?: LineageFilter): DataLineageEvent[] {
  if (!filter) {
    return [...lineageHistory];
  }

  return lineageHistory.filter((event) => {
    if (filter.tenantId && event.tenantId !== filter.tenantId) return false;
    if (filter.entity && event.entity !== filter.entity) return false;
    if (filter.operation && event.operation !== filter.operation) return false;
    return true;
  });
}
