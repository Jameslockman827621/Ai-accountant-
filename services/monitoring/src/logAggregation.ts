import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('monitoring-service');

// Log Aggregation (ELK/OpenSearch integration)
export class LogAggregation {
  private logs: Array<{
    timestamp: Date;
    level: string;
    service: string;
    message: string;
    metadata?: Record<string, unknown>;
  }> = [];

  async sendLog(
    level: string,
    service: string,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const logEntry: {
      timestamp: Date;
      level: string;
      service: string;
      message: string;
      metadata?: Record<string, unknown>;
    } = {
      timestamp: new Date(),
      level,
      service,
      message,
    };

    if (metadata) {
      logEntry.metadata = metadata;
    }

    this.logs.push(logEntry);

    // In production, send to ELK/OpenSearch
    // await fetch('http://elasticsearch:9200/logs/_doc', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify(logEntry),
    // });

    logger.debug('Log sent to aggregation', { service, level });
  }

  async searchLogs(query: {
    service?: string;
    level?: string;
    startDate?: Date;
    endDate?: Date;
    searchText?: string;
  }): Promise<Array<{
    timestamp: Date;
    level: string;
    service: string;
    message: string;
  }>> {
    // In production, query ELK/OpenSearch
    let results = this.logs;

    if (query.service) {
      results = results.filter(log => log.service === query.service);
    }

    if (query.level) {
      results = results.filter(log => log.level === query.level);
    }

    if (query.startDate) {
      results = results.filter(log => log.timestamp >= query.startDate!);
    }

    if (query.endDate) {
      results = results.filter(log => log.timestamp <= query.endDate!);
    }

    if (query.searchText) {
      results = results.filter(log =>
        log.message.toLowerCase().includes(query.searchText!.toLowerCase())
      );
    }

    return results;
  }
}

export const logAggregation = new LogAggregation();
