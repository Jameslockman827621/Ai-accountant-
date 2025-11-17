# Phase 5 – Trust Fabric (Full Implementation)

Phase 5 stitches together security, resilience, monitoring, and legal/compliance guardrails so the AI accountant can run in production for regulated customers.

---

## 1. Experience Surfaces (Web)

- `apps/web/src/components/SecurityCenter.tsx`, `SecurityEventsDashboard.tsx`, `AccountSecurityPanel.tsx`, and `ConnectorAuthorization.tsx` give tenant admins visibility into encryption status, access reviews, pending requests, and connector scopes (`/api/security/encryption-status`, `/api/security/access-requests`, etc.).
- `TrustDashboard.tsx` aggregates organization-wide trust metrics (security events, incidents, SLO status, compliance control approvals, backup success) by calling `/api/security/events`, `/api/security/incidents`, `/api/monitoring/slos`, `/api/compliance/evidence`, `/api/modelops/models`, and `/api/backup/backups`.
- `AccountSecurityPanel.tsx` exposes MFA toggles, session visibility, and device approvals by leveraging the shared authentication APIs.

These components render real metrics, support manual refresh, and use the same token-based auth patterns as the rest of the workspace.

---

## 2. Security Service

- `services/security/src/routes/security.ts` handles:
  - **Security events** (`POST/GET /events`, `/events/:id`, `/events/:id/status`) stored in `security_events`.
  - **Incident response** (`/incidents` CRUD + status updates) stored in `security_incidents`.
  - **Secret rotation ledger** (`/secret-rotations` endpoints) stored in `secret_rotation_logs`, ensuring every credential change is auditable.
- Middleware (`middleware/auth.ts`, `AuthorizationError`) enforces RBAC (only SUPER_ADMIN / ACCOUNTANT roles can fetch incidents, only SUPER_ADMIN can log rotations).
- Services such as `securityEvents.ts`, `incidents.ts`, `secretRotation.ts`, and `permissionsService.ts` handle persistence, status transitions, and downstream notifications.
- Vault/KMS hooks live in `services/security/src/vault.ts` and `services/security/src/services/secrets.ts`, preparing the path for real Vault/KMS usage while logging operations today.

---

## 3. Monitoring, Alerting & Observability

- `services/monitoring` provides:
  - Middleware (`middleware/metricsMiddleware.ts`, `tracingMiddleware.ts`) instrumenting every HTTP service with Prometheus metrics + tracing headers.
  - Services (`services/metrics.ts`, `services/tracing.ts`, `services/alertingService.ts`, `services/sloService.ts`, `services/sloTracking.ts`, `services/queueMetrics.ts`) to store SLO definitions, queue stats, and integrate with PagerDuty/Opsgenie (`pagerduty.ts`, `pagerdutyOpsgenie.ts`).
  - `enhancedAPM.ts`, `apm.ts`, and `distributedTracing.ts` wrappers to connect to Datadog/New Relic/Jaeger depending on deployment.
  - Grafana dashboards (`grafana/*.json`) for SLA/SLO monitoring.
- Every service imports `metricsMiddleware`/`tracingMiddleware` and uses structured logging via `@ai-accountant/shared-utils` so logs can be streamed into ELK/OpenSearch.

---

## 4. Backup, Restore & Disaster Recovery

- `services/backup` ships full data protection:
  - `services/backup/src/services/dataExport.ts` exports tenant data (JSON/CSV/SQL) straight from Postgres, compresses with gzip, encrypts, and uploads to S3/MinIO using signed URLs.
  - `services/backup/src/services/restore.ts` performs full/selective restores with integrity verification, rollback snapshots (`restore_snapshots`), and asynchronous execution via `performRestore`.
  - `services/backup/src/services/automatedBackup.ts` schedules periodic backups, verifies success, and records stats.
  - `services/backup/src/services/pointInTimeRecovery.ts` handles PITR metadata.
- APIs exposed via `/api/backup` allow tenants to request exports, track restore status, and check backup history.
- Front-end Trust Dashboard uses these endpoints to display last backup time and success rate.

---

## 5. Resilience & Error Recovery

- `services/error-handling/src/workers/retryWorker.ts` drains the `error_retries` table, republishes document/OCR/bank/filing retries, and enforces exponential backoff + max retry counts.
- `services/resilience` provides health checks (`healthChecks.ts`), circuit breaker helpers, service mesh adapters (`serviceMesh.ts`), and chaos helpers so staging environments can validate failover.
- Queue DLQs exist for every ingestion worker, and `monitoring` pipeline alerts when DLQ depth exceeds thresholds.

---

## 6. Compliance Evidence & Legal

- Legal/compliance docs (Terms of Service, disclaimers) live in `apps/web/src/pages/TermsOfService.tsx` and have been updated with liability limitations (Phase 1 deliverable).
- Evidence collections tracked by `/api/compliance/evidence` feed the Trust Dashboard and can be exported for auditors.
- `packages/shared-utils` plus `services/security` enforce encrypted storage for sensitive fields (PII, tokens).

---

## 7. Testing & Governance

- Security + resilience are part of integration suites: see `__tests__/integration/serviceCommunication.test.ts`, `__tests__/integration/messageQueue.test.ts`, and `__tests__/e2e/chaos/chaos.test.ts`.
- Linting/CI run `npm run test`, `npm run lint`, and world-class e2e suites to validate security-critical flows (onboarding, billing, filing, autopilot).
- Git hooks plus CODEOWNERS (not shown here) ensure security-related files require review from the right maintainers.

**File name:** `PHASE5_FULL_IMPLEMENTATION.md`
