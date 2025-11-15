# AI Accountant – Unified Implementation Blueprint

_Last updated: 2025-11-15_

This single document replaces all previous implementation/progress/status write-ups. It captures the current foundation, the north-star user experience, and the concrete delivery path to ship a world-class AI accountant from the very first sign-up through ongoing advisory.

---

## 1. Snapshot: Foundation vs. Gaps

**What is already working (kept for context):**
- Multi-model document understanding (GPT-4 ensemble, heuristics, keywords) with immutable audit trails, document versioning, and enhanced OCR.
- Complete UK tax engine (Income, CT, VAT, PAYE, CGT, CIS, reliefs, pension, inheritance, SDLT) plus HMRC OAuth + submission flows, Plaid/TrueLayer bank feeds, Stripe billing skeleton, QuickBooks/Xero connectors, multi-currency support, predictive analytics, automation rules, SOC2 controls, caching, circuit breakers, retries, PITR backups, MFA, and notification scaffolding.
- Service surface area already in repo (`services/*`, `apps/web`, `apps/mobile`) with test scaffolding, monitoring service, and Kubernetes manifests.

**Primary gaps to close:**
1. A coherent, measured customer journey (marketing → sign-up → onboarding → daily usage → advisory) tied to metrics and UX polish.
2. Production-grade ingestion+review UX (status visibility, exception handling, collaboration) wired to real services instead of placeholder data.
3. Programmatic onboarding (KYC, chart-of-accounts templates, bank connection guardrails, historical data import) with success criteria.
4. Support for human-in-the-loop review, escalation, assistant-guided workflows, and secure client/accountant collaboration.
5. Unified observability, SLA enforcement, runbooks, and governance for compliance, security, billing, and support.

---

## 2. North Star & Principles

- **Vision:** Deliver the most trusted autonomous finance team for SMEs—AI-first with transparent controls, proactive insights, and delightful UX across web, mobile, and conversational channels.
- **Product pillars:** (a) Effortless onboarding, (b) Always-correct books & filings, (c) Proactive guidance, (d) Enterprise-grade trust, (e) Frictionless collaboration & billing.
- **Quality bars:**
  - ≥99% classification accuracy with <2 min turnaround for standard docs; ≥95% filings auto-ready, remaining in review queue with SLA.
  - 30 min or less to onboard a new tenant (business profile + data imports) with ≥90% task completion without support.
  - Assistant answers tax/accounting questions with cited evidence and confidence, scoring ≥0.85 on golden dataset evals.
  - Platform SLOs: 99.9% ingestion uptime, 99.5% filing pipeline uptime, RTO ≤ 30 min, RPO ≤ 5 min.

---

## 3. Experience Journey → Implementation Requirements

### 3.1 Discover & Commit
- **Promise:** Prospects grasp value, pricing, compliance posture, and can trial safely.
- **Implementation:**
  - Landing site + in-app onboarding share a unified component library and telemetry funnel.
  - Self-serve trial provisioning script seeds demo data using `GOLDEN_DATASET.md` fixtures.
  - Marketing consent + legal acceptance recorded in auth service, piping to CRM/webhooks.

### 3.2 Sign-Up, Identity & Workspace Creation
- **Promise:** Secure, multi-tenant sign-up with configurable roles.
- **Implementation:**
  - Extend `services/auth` for passwordless + MFA optional flows, invite system, SSO roadmap.
  - Tenant provisioning API packages: subscription plan, data region, default chart of accounts, SOC2 audit log entry.
  - KYC checklist (business info, director verification) stored in compliance schema, surfaced in onboarding UI with progress tracker.

### 3.3 Guided Onboarding & Data Activation
- **Promise:** Clear path to “books in sync” within first session.
- **Implementation:**
  - Onboarding wizard in `apps/web` + mirrored flows in `apps/mobile` for receipt capture; steps: Business profile, Tax scope, Chart mapping, Bank linking, Historical import, Filing preferences.
  - Import adapters (CSV, QuickBooks/Xero pull, Plaid transaction fetch) using existing integrations with validation + rollback.
  - Playbooks + success metrics stored per tenant; autopause wizard if blocking schema issue detected via validation service.

### 3.4 Capture → Classify → Review → Post
- **Promise:** Every document or bank event is processed automatically with visible status, review when needed, and auditability.
- **Implementation:**
  - Queue orchestration (RabbitMQ/Temporal) linking `document-ingest`, OCR, classification, ledger posting with DLQs, retries, Prometheus metrics.
  - Review workspace UI: real-time status board, diff history, AI-suggested edits, chat with assistant referencing `services/assistant` knowledge base.
  - Validation/rules engine gating ledger/filings with configurable thresholds per tenant (already implemented but needs enforcement across services).
  - Mobile capture sends metadata + image, receives immediate classification + next action; push notifications for pending reviews.

### 3.5 Operational Control Center & Collaboration
- **Promise:** Finance lead, accountant, and assistant collaborate in one timeline.
- **Implementation:**
  - Multi-role dashboards (Founder view vs. Accountant view) with tasks, alerts, KPIs.
  - Commenting + assignment threads tied to documents/transactions (store in `support` or new collaboration table) with email/slack notifications.
  - Notebook/timeline of system + human actions pulling from audit log + automation service events.

### 3.6 Compliance, Filings & Payments
- **Promise:** HMRC-ready filings, reconciled accounts, and payment/confidence steps with zero surprises.
- **Implementation:**
  - Filing lifecycle service: draft → validation report → approval → HMRC submission → receipt storage → amendment/resubmission flows; integrate receipts into `services/filing` + storage (S3).
  - Real-time bank reconciliation dashboards using existing reconciliation engine; exception queue with SLA + automation suggestions.
  - Payment orchestration: Stripe subscriptions, usage metering (documents processed, entities), invoice PDFs, proration, dunning.

### 3.7 Proactive Intelligence & Advisory
- **Promise:** Assistant + analytics highlight risks/opportunities before the customer asks.
- **Implementation:**
  - RAG pipeline indexing ledger, filings, analytics outputs, knowledge articles; nightly eval jobs with leaderboard stored in analytics DB.
  - Scenario workspace (tax optimization, cash runway, payroll vs. dividend) leveraging predictive service, exposing recommended journals/actions.
  - Playbook engine triggers automation (send notification, create task, post suggestion) with user confirmation thresholds.

### 3.8 Billing, Account Lifecycle & Expansion
- **Promise:** Transparent usage, instant upgrades, accountant-of-record workflows.
- **Implementation:**
  - Subscription service finalization: seat counts, entity add-ons, overage charges, invoice emails, customer portal.
  - Referral + accountant portal: invite client company, manage multi-tenant switching.
  - Cancellation/downgrade flows gather reasons, export data package, trigger compliance checks (GDPR deletion, access removal).

### 3.9 Trust, Support & Governance
- **Promise:** Always-on support, regulatory compliance, clear accountability.
- **Implementation:**
  - Support center: knowledge base, ticketing integration (Zendesk/Freshdesk) feeding support microservice; SLA board in ops dashboard.
  - Observability baseline: metrics, traces, logs, alert routing to PagerDuty/Slack; include synthetic monitoring for sign-up, ingestion, filing.
  - Security posture: Vault-backed secrets, audit log queries, GDPR tooling (export/delete) exposed in settings, data residency controls.

---

## 4. Platform Workstreams (Cross-Cutting)

1. **Experience & Activation** – Next.js/React web, React Native mobile, marketing site, design system, onboarding wizard, notification center.
2. **Financial OS & Automation** – Ledger, validation, reconciliation, workflow/automation, filings, payment rails, assistant knowledge.
3. **Data, AI & Quality** – RAG indexing, evaluation harness, anomaly detection, simulation environments, golden dataset upkeep.
4. **Reliability, Security & Compliance** – Observability, SLO dashboards, DR drills, access controls, SOC2 evidence, KYC/KYB, support tooling.
5. **Revenue & Lifecycle** – Billing, subscription management, usage metering, pricing experimentation, accountant/referral portals.

Each workstream gets an engineering lead + product counterpart, weekly demos, and shared OKRs.

---

## 5. Delivery Roadmap & Gates

| Phase | Weeks | Theme | Exit Criteria |
| --- | --- | --- | --- |
| **0. Program Reset** | 0-1 | Governance & runway | Single backlog, environment parity, golden dataset refreshed, observability baseline online, owners assigned. |
| **1. Activate & Onboard** | 1-4 | Sign-up → onboarding → first document | Users self-serve sign-up, complete onboarding wizard, upload doc → see review result, connect bank, basic dashboard live, telemetry for funnel. |
| **2. Control & Compliance** | 5-8 | Review workspace, filings, reconciliation | Queue orchestration, validation gates, review UI, filing lifecycle with HMRC receipts, reconciliation dashboards, notification/support center. |
| **3. Intelligence & Growth** | 9-12 | Assistant, automation, billing/commercial | RAG assistant with evals, scenario planning, automation playbooks, subscription management, accountant portal, mobile parity, go-live readiness review. |
| **4. Scale & Optimize** | 13+ | SLO hardening, internationalization | Load testing, chaos drills, SOC2 evidence, KPI instrumentation, plan for multi-country expansion. |

Phase transitions require demo + metrics review + updated runbooks.

---

## 6. Metrics & Instrumentation

- **Acquisition & Activation:** Landing→sign-up conversion, onboarding completion time, bank/link success %, first document-to-ledger latency.
- **Accuracy & Quality:** Classification accuracy, ledger-to-bank reconciliation match rate, filing validation pass rate, assistant answer quality score.
- **Efficiency:** Manual review workload/time, automation coverage %, average handling time per exception, support SLA adherence.
- **Reliability:** Queue depth, job success %, ingestion latency percentiles, filing pipeline uptime, backup verification frequency.
- **Business:** Net ARR, expansion revenue via accountants, churn/retention, NPS/CSAT.

Metrics exported via Prometheus/OpenSearch and visualized in Grafana with alerts.

---

## 7. Immediate Next Actions (Next 30 Days)

1. **Backlog + tooling reset** – Import this plan into Linear/Jira with epics per journey stage, link to owners, and add instrumentation tasks.
2. **Onboarding MVP** – Build wizard UI + APIs (profile, tax scope, chart mapping, bank connect) with progress tracking and telemetry.
3. **Queue + validation hardening** – Wire ingestion services end-to-end with retries, DLQs, validation enforcement, and metrics.
4. **Review workspace** – Replace placeholder data in `apps/web` review components with live APIs, add audit trails + assistant suggestions.
5. **Observability + support baseline** – Stand up metrics/log forwarding, create PagerDuty runbooks, integrate support ticket intake.

---

## 8. Operating Model

- **Teams:** Experience, Financial OS, Intelligence, Reliability, Revenue. Each owns repos/services + shared libraries.
- **Cadence:** Daily standup, twice-weekly bug bash, weekly demo/review tied to KPIs, fortnightly risk review, monthly architecture council.
- **Documentation:** This file is the source of truth. Architecture/runbooks live in `docs/` per service with lightweight ADRs. Update after every phase.
- **Release management:** Trunk-based dev with nightly staging deploy, automated smoke + e2e, weekly production release once SLAs met.
- **Customer feedback loop:** Embed product + support leads in pilot Slack/Teams channels, drive monthly VOC synthesis feeding roadmap.

---

By executing this unified blueprint we eliminate duplicated docs, focus every team on the same journey, and create the world-class AI accountant experience customers expect.
