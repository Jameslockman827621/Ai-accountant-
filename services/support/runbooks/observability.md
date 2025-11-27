# Observability Runbooks

These runbooks standardize response for telemetry issues surfaced by OpenTelemetry, Prometheus, and Grafana. Use the on-call rotation in `oncall-rotation.md` for escalation.

## Availability and latency
1. Check API Gateway and service health on the **SLO & Alerting** Grafana dashboard (`grafana/dashboards/slo-observability.json`).
2. Validate recent alerts from the monitoring service `/alerts` endpoint and PagerDuty/Slack routing.
3. If P95 latency is above target or availability is below 99.9%:
   - Roll back the last deployment for the impacted service.
   - Inspect upstream dependencies in the distributed trace view for slow spans.
   - Capture a trace ID from the alert payload or `x-trace-id` response header and replay using the tracing backend.
4. If database waits dominate latency, fail over to the read replica and scale the pool by 25%.
5. Update the incident ticket with the trace IDs, mitigation, and next steps.

## Trace export pipeline
1. Confirm the OpenTelemetry Collector pod health (`k8s/monitoring/otel-collector.yaml`) and check logs for exporter errors.
2. Use the monitoring service SLO endpoint to verify `slo-trace-export` status and error budget.
3. If success rate <95%:
   - Switch collector exporter to the `logging` exporter temporarily (set `OTEL_EXPORTER_OTLP_ENDPOINT` fallback).
   - Throttle noisy services by reducing sampling in `services/observability` via `OTEL_TRACES_SAMPLER_ARG`.
   - Requeue failed exports from the `telemetry_exports` table by marking them `pending`.
4. Notify the on-call SRE and incident commander with the scope of dropped traces and time window.

## Error rate or reconciliation accuracy
1. Validate alert thresholds in `services/monitoring/src/alertRules.ts` to ensure the correct SLO policy fired.
2. Check recent code deploys for the impacted service; if within 30 minutes, initiate an automatic rollback.
3. Compare error spikes with external dependency status pages; enable circuit breakers if required.
4. If reconciliation accuracy <98%, pause downstream filing workflows and trigger a backfill job after fixes.

## Escalation
- Page the **primary on-call** via PagerDuty for critical alerts.
- If no response in 10 minutes, escalate to **secondary on-call** then to the **observability lead**.
- Document all steps and attach Grafana screenshots to the incident record.
