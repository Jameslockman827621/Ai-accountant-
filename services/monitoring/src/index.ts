/**
 * Monitoring Service
 * Central observability service for metrics, tracing, and logging
 */

import express, { Express } from 'express';
import { initializeMetrics } from './metrics';
import { initializeTracing } from './tracing';
import { metricsMiddleware } from './middleware/metricsMiddleware';
import { tracingMiddleware } from './middleware/tracingMiddleware';
import { registerAlertRules } from './alertRules';
import { alertingService } from './alerts';
import { createLogger } from './logging';

const logger = createLogger('monitoring-service');
const app: Express = express();
const PORT = process.env.PORT || 3010;

// Initialize observability
initializeMetrics();
initializeTracing();
registerAlertRules();

app.use(express.json());
app.use(metricsMiddleware);
app.use(tracingMiddleware);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'monitoring-service' });
});

// Metrics endpoint (Prometheus)
app.get('/metrics', async (_req, res) => {
  // Prometheus exporter serves metrics on its own endpoint
  // This is a placeholder - actual metrics are served by PrometheusExporter
  res.json({ message: 'Metrics available at /metrics endpoint configured in PrometheusExporter' });
});

// Alerts endpoint
app.get('/alerts', (_req, res) => {
  const alerts = alertingService.getActiveAlerts();
  res.json({ alerts });
});

// Alert resolution endpoint
app.post('/alerts/:alertId/resolve', (req, res) => {
  const { alertId } = req.params;
  alertingService.resolveAlert(alertId);
  res.json({ message: 'Alert resolved', alertId });
});

app.listen(PORT, () => {
  logger.info(`Monitoring service listening on port ${PORT}`);
});

export default app;
