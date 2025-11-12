import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('monitoring-service');

// Grafana Dashboard Configuration
export const dashboardConfigs = {
  main: {
    title: 'AI Accountant SaaS - Main Dashboard',
    panels: [
      {
        title: 'Request Rate',
        query: 'rate(api_calls_total[5m])',
      },
      {
        title: 'Error Rate',
        query: 'rate(api_calls_total{status="error"}[5m])',
      },
      {
        title: 'Response Time (p95)',
        query: 'histogram_quantile(0.95, api_call_duration_ms)',
      },
      {
        title: 'Active Users',
        query: 'active_users',
      },
    ],
  },
  services: {
    title: 'Service Health Dashboard',
    panels: [
      {
        title: 'Service Uptime',
        query: 'up{service=~".+"}',
      },
      {
        title: 'Service Error Rate',
        query: 'rate(service_errors_total[5m])',
      },
      {
        title: 'Service Latency',
        query: 'histogram_quantile(0.95, service_request_duration_seconds)',
      },
    ],
  },
  business: {
    title: 'Business Metrics Dashboard',
    panels: [
      {
        title: 'Documents Processed',
        query: 'documents_processed_total',
      },
      {
        title: 'Filings Submitted',
        query: 'filings_submitted_total',
      },
      {
        title: 'VAT Calculated',
        query: 'vat_calculations_total',
      },
    ],
  },
};

export function generateGrafanaDashboard(name: keyof typeof dashboardConfigs): unknown {
  const config = dashboardConfigs[name];
  logger.info('Generating Grafana dashboard', { name });
  return config;
}
