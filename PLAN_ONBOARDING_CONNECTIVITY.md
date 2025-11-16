# Plan: Instant Onboarding & Connectivity

Design chunks sized so an AI coding tool can execute each end-to-end (backend + frontend) in a single pass.

---

## Chunk 1 — Globally Adaptive Onboarding Flow

**Goal**  
Let tenants from any jurisdiction finish onboarding in one session, with dynamic steps, localization, and saved progress.

**Backend Spec**
- Extend `services/onboarding` to store jurisdiction, entity type, and industry in structured tables; add migrations for `jurisdictions`, `entity_types`, `onboarding_step_data`.
- Add `/api/onboarding/schema` route returning enabled steps, required fields, and validation rules per jurisdiction.
- Implement localization helpers (currency, date formats) surfaced via the schema.
- Persist per-step data via `/api/onboarding/steps/:step` (PATCH) with validation middleware referencing schema.
- Emit events (`onboarding.step.completed`, `onboarding.completed`) to RabbitMQ for downstream automation.

**Frontend Spec**
- Update `OnboardingWizard` to fetch schema on mount, render step list dynamically, and show localized copy (currency/date labels).
- Add client-side validation based on schema metadata (required, regex, option lists).
- Provide save/resume ability using optimistic updates and spinner states for slow calls.
- Instrument analytics (`trackEvent`) to emit jurisdiction and industry metadata.

**Acceptance Criteria**
- Users can select any supported jurisdiction (UK, US, EU, CA, MX, AU, SG, etc.) and see tailored steps.
- Step completion persists on refresh; wizard resumes at last incomplete step.
- Validation errors surface inline with localized labels.

---

## Chunk 2 — Production-Grade KYC & AML

**Goal**  
Replace mock/internal flow with real providers (Persona + Onfido) plus sanctions screening and manual review queue.

**Backend Spec**
- Introduce provider adapters under `services/onboarding/src/services/kyc/providers/{persona,onfido}` with typed requests/responses.
- Store verification sessions, statuses, webhook payloads, and audit log entries (`kyc_audit_events` table).
- Implement `/api/onboarding/kyc/sessions` (POST) to start verification and return provider handoff URLs.
- Add webhook endpoints `/api/onboarding/kyc/webhooks/:provider` verifying signatures and updating statuses.
- Build review queue endpoints `/api/onboarding/kyc/reviews` for compliance officers (list, patch outcome).

**Frontend Spec**
- Create `KYCVerificationPanel` in web app onboarding area that shows verification status timeline, retry CTA, and manual review messaging.
- Add admin view (feature flag `complianceReview`) listing pending reviews with approve/reject controls.
- Surface sanctions-hit warnings inline with required documentation upload UI.

**Acceptance Criteria**
- Starting KYC returns real provider session URL; callbacks update status within 30 seconds.
- Compliance reviewer can approve/reject with notes; audit trail persists.
- Users blocked on KYC see clear instructions and retry options.

---

## Chunk 3 — Connector Automation Hub

**Goal**  
Automate connection of banks, accounting platforms, payroll, and commerce sources immediately after onboarding.

**Backend Spec**
- Build `connector_catalog` table describing providers (Plaid, TrueLayer, QuickBooks, Xero, Gusto, Shopify, Stripe, PayPal, Codat, Yodlee).
- Create `/api/connectors/:provider/link-token` style routes that normalize auth/token workflows across services.
- Implement background job `connectorProvisioningWorker` that listens for `onboarding.completed` events, orchestrates sequential connection prompts, and retries failures with exponential backoff.
- Extend bank-feed service to support Yodlee (Europe) and Codat (global) by adding service adapters and storing refresh tokens.
- Add health monitoring cron to ping every connection daily and raise alerts when stale.

**Frontend Spec**
- Replace `BankConnectionsPanel` with `UnifiedConnectionsPanel` showing tabs (Bank, Accounting, Payroll, Commerce) and per-source status with CTA buttons.
- Provide guided modal that steps through highest-priority connectors, using provider-specific instructions from catalog metadata.
- Add badges for “Auto-sync ON/OFF”, last sync timestamps, and error banners with retry buttons.

**Acceptance Criteria**
- After onboarding, users see at least one suggested connector per category and can initiate linking without leaving dashboard.
- Health checks mark broken connections within 15 minutes and show actionable remediation steps.
- Connecting QuickBooks or Xero triggers initial chart-of-accounts + historical transaction sync jobs automatically.
