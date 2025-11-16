# Plan: Reliability, Security & Observability

Chunked roadmap covering tests, monitoring, security hardening, and operational excellence.

---

## Chunk 1 — Test Automation & Golden Dataset

**Goal**  
Raise coverage to ≥80% and create deterministic datasets verifying OCR → classification → ledger → filing pipelines.

**Backend Spec**
- Add golden dataset fixtures under `__tests__/golden-dataset` (documents, extracted JSON, ledger expectations).
- Implement Jest projects per service with shared helpers for DB seeding + teardown.
- Create integration test harness using Docker Compose to spin up API Gateway + key services; add GitHub Action job.
- Build CLI `npm run golden:test` that runs full ingestion pipeline on fixtures and compares outputs with stored snapshots.
- Add mutation testing (Stryker) for critical modules (rules-engine, filing).

**Frontend Spec**
- Configure Playwright for end-to-end flows (login, onboarding, document upload, filing approval).
- Add storybook + visual regression tests for core components (OnboardingWizard, FilingControlTower, DocumentReviewPanel).

**Acceptance Criteria**
- CI fails if coverage <80% or golden dataset diff exceeds threshold.
- Developers can run `npm run test:all` locally to execute unit + integration + e2e suites with minimal setup.

---

## Chunk 2 — Monitoring, Alerting & SLOs

**Goal**  
Provide production-grade visibility with metrics, logs, traces, alert routing, and runbooks.

**Backend Spec**
- Instrument services with OpenTelemetry SDK; export traces to OTLP collector.
- Publish metrics (request latency, queue depth, job failures) via Prometheus endpoints; add Grafana dashboards per domain (ingestion, filing, assistant).
- Configure structured logging with correlation IDs; ship to OpenSearch/Loki.
- Define SLOs (e.g., OCR median <6s, filing success >99.5%, onboarding completion <10 min) and create alert rules in Grafana/Alertmanager routed to Slack/PagerDuty.
- Add synthetic monitors for critical APIs (health, login, document upload, filings).

**Frontend Spec**
- Build internal `SLODashboard` component summarizing SLO status, error budgets, active incidents.
- Add toast/banner surfaces for degraded dependencies (e.g., HMRC outage) based on feature flag service.

**Acceptance Criteria**
- Every service exposes `/metrics` and `/health` endpoints consumed by monitoring stack.
- On failure (e.g., filing job backlog), alert fires with runbook link within 2 minutes.

---

## Chunk 3 — Security & Compliance Foundations

**Goal**  
Implement encryption at rest, secrets management, access controls, and audit readiness (SOC 2 / GDPR baseline).

**Backend Spec**
- Integrate HashiCorp Vault or AWS KMS for secrets; replace `.env` secrets with dynamic fetch + caching.
- Encrypt sensitive columns (PII, tokens) using application-layer envelope encryption.
- Enforce row-level security per tenant across all services; add automated tests verifying isolation.
- Implement permissions service centralizing RBAC/ABAC policies with caching and admin UI.
- Build data retention + deletion jobs honoring GDPR (right to erasure).
- Document incident response + change management workflows in repo.

**Frontend Spec**
- Update admin UI to manage roles/permissions, show audit logs, and request elevated access with approval flow.
- Add security center panel showing encryption status, compliance checklists, pending user access reviews.

**Acceptance Criteria**
- Secrets never stored in plain text on disk; rotation can occur without downtime.
- Access to another tenant’s data blocked by automated tests; audit logs capture every privileged action.

---

## Chunk 4 — Resilience, Backups & Chaos

**Goal**  
Guarantee recovery from failures via automated backups, restore drills, circuit breakers, and chaos testing.

**Backend Spec**
- Configure daily PITR backups for PostgreSQL + object storage snapshots; store metadata in `backup_catalog`.
- Add `backup-restore` CLI that can recreate staging from latest backup; automate monthly restore tests.
- Implement circuit breakers + retries around external APIs (bank feeds, KYC, filings) with fallback queues.
- Introduce chaos tooling (Gremlin/Litmus) scripts to kill pods, inject latency, and ensure services recover.
- Add disaster recovery runbooks and RTO/RPO metrics.

**Frontend Spec**
- Display data residency and backup status in settings for transparency.
- Surface degraded mode banners when circuit breakers open, explaining limited functionality.

**Acceptance Criteria**
- Restore drill completes within defined RTO (e.g., 1 hour) and is logged.
- Chaos experiments run weekly with pass/fail reported; no user data loss during tests.
