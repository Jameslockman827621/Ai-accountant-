import { randomUUID } from 'crypto';
import { AccessLogEntry } from '@ai-accountant/shared-types';
import { createServiceLogger } from '@ai-accountant/observability';

const auditLogger = createServiceLogger('auth-audit');
const accessLogs: AccessLogEntry[] = [];
const MAX_LOGS = 500;

export function recordAccessLog(entry: Omit<AccessLogEntry, 'id' | 'createdAt'>): AccessLogEntry {
  const log: AccessLogEntry = {
    ...entry,
    id: randomUUID(),
    createdAt: new Date(),
  };

  accessLogs.unshift(log);
  if (accessLogs.length > MAX_LOGS) {
    accessLogs.pop();
  }

  auditLogger.info('Access log recorded', {
    id: log.id,
    action: log.action,
    actorId: log.actorId,
    status: log.status,
    traceId: log.traceId,
  });

  return log;
}

export function listAccessLogs(tenantId: string): AccessLogEntry[] {
  return accessLogs.filter((log) => log.tenantId === tenantId);
}
