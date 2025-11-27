/**
 * Monitoring Service
 * Central observability service for metrics, tracing, and logging
 */

import express, { Express } from 'express';
import { initializeTracing } from './tracing';
import { registerAlertRules } from './alertRules';
import { alertingService } from './alerts';
import { createServiceLogger, createMetricsMiddleware, createTracingMiddleware } from '@ai-accountant/observability';
import { telemetryRouter } from './routes/telemetry';

const SERVICE_NAME = 'monitoring-service';
const logger = createServiceLogger(SERVICE_NAME);
const app: Express = express();
const PORT = process.env.PORT || 3010;

// Initialize observability
initializeTracing();
registerAlertRules();

app.use(express.json());
app.use(createMetricsMiddleware(SERVICE_NAME));
app.use(createTracingMiddleware(SERVICE_NAME));
app.use('/api', telemetryRouter);

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
