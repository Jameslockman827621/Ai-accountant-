# AI Accountant – Production Implementation Plan

_Last updated: 2025-11-14_

## 1. Objectives
- Deliver a production-ready, fully auditable AI accountant covering ingestion → ledger → filings with human review controls.
- Close critical gaps called out in `PRODUCTION_READINESS_GAP_ANALYSIS.md` around validation, UX, compliance, monitoring, and billing.
- Establish repeatable DevOps practices (testing, observability, backups) and governance (audit, legal, support).

## 2. Success Criteria
1. **Operational pipeline** – Documents flow automatically through OCR → classification → validation → ledger with retries, DLQs, and review tooling. ≥95% of high-confidence docs auto-posted, the rest routed to review within 2 minutes.
2. **Regulatory-grade filings** – VAT/PAYE/CT filings generated from ledger data, reviewed, approved, and submitted with HMRC receipts stored; rejection/amendment workflows operational.
3. **Data quality & controls** – Tax/ledger validation suite, anomaly detection, reconciliation, and manual correction flows enforced before postings/filings.
4. **Customer experience** – Guided onboarding, processing status, notification center, billing & support flows implemented across web/mobile.
5. **Production readiness** – 80%+ automated test coverage on critical services, monitored infrastructure (metrics/traces/logging), automated backups, SOC2-aligned security controls.

## 3. Phased Delivery Plan

| Phase | Duration | Theme | Key Outcomes |
| --- | --- | --- | --- |
| 0 | 1 week | Planning & foundations | Implementation plan, backlog grooming, env setup, golden dataset seeds |
| 1 | 3 weeks | Pipeline reliability | End-to-end ingestion path, validation layer, review UX, filing workflow scaffolding |
| 2 | 3 weeks | Compliance & integrations | HMRC OAuth, bank-feed resiliency, audit logging, notification/support, billing |
| 3 | 3 weeks | Intelligence & production ops | RAG ingestion, monitoring/alerting, backups/DR, expanded testing, polish |

### Phase 0 – Planning & Enablement (Week 0-1)
- **Backlog & tracking**: Convert this plan into tracked epics (Jira/Linear) with explicit owners, estimations, dependencies.
- **Environment hardening**: Ensure shared `.env.example` complete, secret management (Vault or Doppler) wired for dev/stage/prod.
- **Golden dataset**: Curate representative documents, ledger snapshots, filings for automated regression tests.
- **Tech debt audit**: Identify blocking schema gaps (missing tables, FK constraints) and create migration plan.
- **Team alignment**: Assign DRIs per workstream (Pipeline, Validation, Filing, UX, Integrations, Ops).

### Phase 1 – Pipeline Reliability (Weeks 1-3)
**1. Queue & worker orchestration**
  - Wire `document-ingest` to establish RabbitMQ connections on startup; emit OCR/classification jobs with retry/DLQ handling.
  - Update OCR worker to publish classification jobs, classification worker to push ledger jobs, ledger worker to ack/retry with DLQ + alerting hooks.
  - Implement idempotent job handlers and ensure transactional updates for document status.

**2. Validation & quality gates**
  - Create `services/validation` package housing tax calculators, data accuracy checks, anomaly detection, confidence thresholds, duplicate detection.
  - Embed validation middleware before ledger postings and filings; enforce review when confidence < 85% or discrepancies detected.

**3. Manual review workflow**
  - Back-end routes for fetching review queue, editing extracted fields, approving/rejecting documents; persist audit trail.
  - Update `apps/web` components (`DocumentReview`, `ProcessingStatus`, `ErrorRecovery`) to consume real APIs; add notifications for state changes.

**4. Filing workflow scaffolding**
  - Implement filing review checklist service, draft management, attestation steps, storage of HMRC receipts (mock for now).
  - Introduce scheduler (BullMQ / Temporal / cron) for filing reminders and bank syncs.

**Exit criteria**: Document uploaded via UI completes OCR/classification automatically, appears in review queue if low confidence, can be edited and posted to ledger; ledger entries feed VAT draft with validation report; e2e test covers full happy path.

### Phase 2 – Compliance, Integrations, Customer Experience (Weeks 4-6)
**1. HMRC & filings**
  - Replace client-credential token with per-tenant OAuth (MTD requirements), persist refresh tokens encrypted, handle VRN scopes.
  - Submit filings to HMRC sandbox, capture receipt IDs, store in `filing_receipts`, implement amendment/resubmission flows.

**2. Bank feeds & reconciliation**
  - Secure storage (KMS) for Plaid/TrueLayer tokens, token refresh service, webhook ingestion for transactions.
  - Reconciliation engine matching bank transactions to ledger, generating reports and exceptions queue.
  - CSV import fallback with validation.

**3. Billing & monetization**
  - Complete Stripe integration (checkout/session, webhook signature verification, subscription states, invoice PDFs).
  - Enforce plan limits (documents per month, number of clients), upgrade/downgrade flows in `SubscriptionManagement`.

**4. Customer experience**
  - Onboarding wizard (business profile, VAT, chart of accounts, bank link steps).
  - Help center + support ticket backend (Zendesk/Freshdesk or custom), notification center (email + in-app).
  - Mobile receipt capture hooking into APIs, push notifications for filings/bank sync issues.

**Exit criteria**: Tenant can onboard from scratch, connect bank, upload docs, review & submit filing with HMRC receipt, manage subscription, and receive proactive alerts. Support tickets and notifications function end-to-end.

### Phase 3 – Intelligence, Monitoring, Ops Excellence (Weeks 7-9)
**1. AI knowledge ingestion & evaluation**
  - Trigger `indexDocument` after extraction + validation; add ledger/filing excerpts with metadata for RAG.
  - Conversation service to store messages, citations, feedback; add guardrails (moderation, PII redaction).
  - Golden dataset for assistant responses; nightly evaluation jobs measuring accuracy, latency, confidence.

**2. Observability & reliability**
  - Inject monitoring middleware into all services (metrics, tracing, structured logging); ship to Prometheus + Grafana + OpenSearch.
  - Configure alerting (PagerDuty/Slack) for job failures, queue backlog, filing errors.
  - Implement DLQs for RabbitMQ and scheduled reprocessing/backoff strategies.

**3. Backups, DR, security**
  - Automated PostgreSQL + S3 backups, restore playbooks, verification jobs.
  - Secrets via Vault/KMS; rotate keys, enforce MFA, RBAC, audit logging on all admin actions.
  - GDPR tooling (export/delete), legal disclaimers on filings, acceptance tracking.

**4. Testing & release automation**
  - Expand unit/integration/E2E coverage to ≥80% for critical services, including bank feeds, filings, assistant.
  - Load testing suite (k6/Gatling) and chaos experiments for queue/database outages.
  - CI/CD enhancements: typecheck, lint, tests, Docker builds, staging deploy + smoke tests, canary promote.

**Exit criteria**: System operates with production-grade SLOs (99.9% uptime for ingestion/filing), monitored surfaces with actionable alerts, recoverability proven, AI assistant backed by evaluated knowledge base, comprehensive automated test suite.

## 4. Cross-Cutting Workstreams

1. **Data & Schema** – Complete migrations, enforce FK/indexes, add audit log tables, data retention policies.
2. **Security & Compliance** – Penetration testing, SOC2 controls, GDPR readiness, legal pages/disclaimers.
3. **Documentation & Runbooks** – Update architecture diagrams, service runbooks, SOPs for support/ops, developer guides.
4. **Program Management** – Weekly status checkpoints, burndown dashboards, risk log, decision register.

## 5. Immediate Next Actions
1. Stand up queue connections and full ingestion pipeline (Phase 1.1).
2. Implement validation service skeleton and integrate with ledger posting.
3. Replace placeholder UI data with live APIs for review/status/error recovery.
4. Draft HMRC OAuth + receipt storage design while Phase 1 progresses.
5. Establish monitoring baseline (metrics/log forwarding) so future work is observable.

---

This plan should be treated as a living document; update it as milestones complete or new risks surface. Each phase must exit with automated tests, documentation, and clear rollout instructions before proceeding.
