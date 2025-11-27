# Immediate Operations Action Plan

This plan operationalizes the next critical steps across performance, resilience, compliance, and partner integration enablement.

## 1) Load & Performance Testing of Critical Paths
- **Scope**: login, document upload → OCR → classification → ledger post → filing submission; assistant chat; webhook ingestion; billing/subscription flows.
- **Approach**:
  - Build k6 scripts under `scripts/perf/` with scenarios for API Gateway and service-specific hot paths; include message-queue depth checks.
  - Capture baseline service-level objectives (p95 latency, error rate, queue drain rates) and size autoscaling rules (HPA targets, worker pool scaling per queue depth).
  - Run sustained (30–60m) and spike tests against staging; gate releases on SLO conformance.
- **Deliverables**:
  - `scripts/perf/` suite, GitHub Action job `perf-check` triggered nightly and on release branch merges.
  - Grafana dashboard panels for queue depth, worker saturation, DB read/write IOPS, and cache hit rate.
  - Playbook for tuning RabbitMQ prefetch, consumer concurrency, and Node.js threadpool sizing.

## 2) Backup, Restore, and Disaster Recovery
- **Backup Automation**:
  - Nightly PostgreSQL PITR snapshots + WAL archival; daily MinIO/S3 object versioning; configuration stored in `k8s/backup/` manifests.
  - GitHub Action `backup-verify` to run checksum validation on latest backup artifacts.
- **Restore & DR Rehearsal**:
  - Monthly restore drill pipeline that rebuilds staging from latest backups, runs smoke tests, and reports RTO/RPO in Slack.
  - Document step-by-step runbooks under `docs/runbooks/` (backup, restore, regional failover) with owner + paging channels.
- **Acceptance**:
  - DR drill completes <60 minutes with data freshness <15 minutes; evidence stored in `docs/drills/<date>.md`.

## 3) Staging Environment, CI/CD Gates, Security & Privacy Readiness
- **Staging Stack**:
  - Terraform/K8s overlays for staging (`k8s/overlays/staging/`) with representative data seeding and feature flags mirrored to production defaults.
  - CI gates: lint, type-check, unit/integration, Playwright e2e, perf smoke, SBOM + SAST/DAST, policy checks (OPA/Conftest) before deploy.
- **Security & Privacy Assessments**:
  - Run SOC2/ISO control mapping in `compliance/controls/` with evidence links; track GDPR data flows and retention in `docs/gdpr/`.
  - Add recurring dependency scanning (Snyk/Dependabot), container image signing (cosign), and vulnerability exemption process.
  - Pen-test schedule with findings triage SLAs; add security champion rotation and threat modeling cadence.
- **Observability/Access**:
  - SSO enforced for staging + production with least-privilege RBAC; short-lived credentials via Vault.
  - Centralized audit logging forwarded to SIEM with alerting rules for anomalous access and data egress.

## 4) OpenAPI/Swagger Documentation & Developer Portal
- **API Contracts**:
  - Ensure each service exports OpenAPI specs under `services/*/openapi.yaml`; add linting (openapi-cli) and publish via CI to `docs/api/`.
  - Use Stoplight/Redocly to host a versioned portal with SDK generation (TypeScript/Python) and examples for ingest, filings, webhook verification, and OAuth flows.
- **Portal & Integrations**:
  - Publish developer onboarding guides (auth, sandbox keys, webhook replay, test data) and postman collections.
  - Track partner metrics (active apps, error rates) in the portal; provide status page links and changelog RSS/Atom feeds.

## Ownership & Timeline
- **DRI**: Reliability lead (ops), Security lead (compliance), Platform lead (infra), DX lead (developer portal).
- **Timeline**: Kick off immediately; target first staging deploy with CI/CD gates and published OpenAPI portal within 2 weeks; first DR drill + performance baseline within 3 weeks.
- **Definition of Done**: All deliverables checked in with runnable automation, dashboards live, and compliance artifacts linked.
