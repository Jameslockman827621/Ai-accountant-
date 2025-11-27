import { context, trace } from '@opentelemetry/api';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('monitoring-service');

interface StructuredLog {
  timestamp: Date;
  level: string;
  service: string;
  message: string;
  environment: string;
  traceId?: string;
  spanId?: string;
  metadata?: Record<string, unknown>;
}

// Log Aggregation (Grafana Loki / ELK integration)
export class LogAggregation {
  private logs: StructuredLog[] = [];
  private lokiEndpoint = process.env.GRAFANA_LOKI_ENDPOINT;
  private elkEndpoint = process.env.ELASTICSEARCH_ENDPOINT;

  async sendLog(
    level: string,
    service: string,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const activeSpan = trace.getSpan(context.active());
    const spanContext = activeSpan?.spanContext();

    const logEntry: StructuredLog = {
      timestamp: new Date(),
      level,
      service,
      message,
      environment: process.env.NODE_ENV || 'development',
      ...(spanContext?.traceId ? { traceId: spanContext.traceId } : {}),
      ...(spanContext?.spanId ? { spanId: spanContext.spanId } : {}),
      ...(metadata ? { metadata } : {}),
    };

    this.logs.push(logEntry);
    await Promise.all([this.shipToGrafana(logEntry), this.shipToElasticsearch(logEntry)]);
    logger.debug('Log sent to aggregation', { service, level });
  }

  async searchLogs(query: {
    service?: string;
    level?: string;
    startDate?: Date;
    endDate?: Date;
    searchText?: string;
  }): Promise<StructuredLog[]> {
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

  private async shipToGrafana(logEntry: StructuredLog): Promise<void> {
    if (!this.lokiEndpoint) return;

    // In production, POST to Grafana Loki push API
    logger.debug('Would ship log to Grafana Loki', {
      endpoint: this.lokiEndpoint,
      level: logEntry.level,
      service: logEntry.service,
    });
  }

  private async shipToElasticsearch(logEntry: StructuredLog): Promise<void> {
    if (!this.elkEndpoint) return;

    // In production, POST to Elasticsearch/Opensearch
    logger.debug('Would ship log to Elasticsearch', {
      endpoint: this.elkEndpoint,
      level: logEntry.level,
      service: logEntry.service,
    });
  }
}

export const logAggregation = new LogAggregation();
