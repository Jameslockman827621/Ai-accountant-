# Phase 1 – Clarity Onboarding (Full Implementation)

This document captures the **implemented surface area** for Phase 1, covering both the customer-facing experiences and the services that turn intent capture into a production-ready tenant configuration.

---

## 1. Product Surface (Web)

- `apps/web/src/components/OnboardingWizard.tsx` and `OnboardingWizardEnhanced.tsx` render the multi-step wizard (welcome → business profile → tax scope → connectors → filings → first document). Autosave and contextual copy are driven by `useOnboarding` so users can resume from any device.
- `OnboardingProgressCard.tsx`, `OnboardingSuccessPlan.tsx`, and `OnboardingFunnelMetrics.tsx` provide embedded cards for dashboards/admin views: they read telemetry from `/api/onboarding/progress`, plot step completion, and summarize “next commitments” for each tenant.
- `KYCVerification.tsx`, `ConsentCapture.tsx`, and `ConnectorAuthorization.tsx` handle vertical slices inside the wizard. They proxy to `/api/onboarding/steps/:stepName`, `/api/onboarding/events`, and `/api/onboarding/tutorials` so every interaction is auditable.
- `DocumentUpload.tsx` (when invoked from onboarding via `source="onboarding"`) gives immediate quality scores and routes the file to the review queue without leaving the wizard.

Every component uses the shared Tailwind primitives, adheres to the responsive layout guidelines, and can be embedded inside the global `app/onboarding` route (Next.js App Router). Authentication is handled client-side via the auth token stored in `localStorage`, matching the rest of the dashboard pages.

---

## 2. API & Service Layer

| Concern | Implementation |
| --- | --- |
| HTTP surface | `services/onboarding/src/routes/onboarding.ts` exposes schema discovery, progress, step mutations, resets, telemetry events, tutorial content, and sample-data generation. Each route validates the authenticated tenant/user via `middleware/auth.ts`. |
| State machine | `services/onboarding/src/services/orchestrator.ts` maintains the canonical onboarding session record (`onboarding_sessions`), enforces the state transitions (`initialized → business_profile → … → completed`), and emits provisioning hooks (chart of accounts, filing calendar, AI memory) once KYC is approved. |
| Schema + validation | `services/onboarding/src/services/onboardingSchema.ts` and `validateStepData` assemble jurisdiction/entity specific forms so front-end steps stay declarative. Failed validations are surfaced as HTTP 400 responses for inline UX errors. |
| Telemetry/events | `services/onboarding/src/services/onboardingEvents.ts` pushes durable events (wizard_opened, step_completed, onboarding.completed, etc.) onto RabbitMQ via `document-ingest` style queue utilities so downstream services (ledger, assistant, analytics) react idempotently. |
| Tutorials/copilot | `services/onboarding/src/services/tutorialEngine.ts` hosts the contextual help, gating steps and surfacing quick actions inside the wizard. |
| Sample data | `services/onboarding/src/services/sampleDataGenerator.ts` seeds demo ledger entries, filings, and bank connections for sandboxes. |

Security is enforced with tenant-scoped queries, audit logs created through `recordOnboardingEvent`, and MFA/role checks delivered by the shared auth middleware (see `services/auth`).

---

## 3. Provisioning & Data Contracts

- **Intent profile** (`intent_profiles`) stores jurisdiction, industry, accounting method, connectors and goals that get recorded by the wizard, then injected into the assistant via the AI memory ingestion in the orchestrator.
- **Consent ledger** captures authorizations. The `connectorCatalog` / `consentLedger` services run inside `services/onboarding/src/services` and write to `consent_records` with expiry metadata; reminders are later picked up by `notification-service`.
- **Connector registry** table tracks Plaid, TrueLayer, HMRC OAuth, IRS/CRA placeholders, Shopify, Stripe connections; onboarding writes the expected vs. provisioned connectors so the dashboard can highlight unmet prerequisites.
- **Filing calendars** are generated in `generateFilingCalendar` using intent profile data (jurisdiction, obligations, frequency) and persisted to `filing_calendars`.
- **AI memory documents** are created via `createAIMemoryDocuments` so the assistant (`services/assistant/src/services/rag.ts`) can reference “Business Intent Summary” vector embeddings from day one.

Each mutation inside onboarding happens through `db.query` calls with transactions where necessary; nothing is stored inside the web app.

---

## 4. Integrations & Automation Hooks

- Connector steps call out to `services/integrations` (Plaid, TrueLayer, HMRC) after onboarding emits `onboarding.step.completed` events. All credentials land in `stripe_connections`, `bank_connections`, etc., with secret material stored via the `secure-store` package.
- KYC flows leverage `services/onboarding/src/services/kyc` (Persona + Onfido adapters) and write verification tokens to the database. Failed verifications set the session to `error`, which the wizard surfaces with retry instructions.
- When onboarding hits the `chart_of_accounts` and `filing_calendar` steps, the orchestrator invokes:
  - `provisionChartOfAccounts` to copy the industry template (standard, retail, SaaS, services) into `chart_of_accounts`.
  - `generateFilingCalendar` to create VAT/PAYE/CT rows and enable deadline reminders.
  - `createAIMemoryDocuments` and `emitOnboardingEvent('onboarding.completed')`, which the assistant and automation services subscribe to so they can warm caches.

---

## 5. Ops, Monitoring & QA

- All onboarding API calls use `createLogger('onboarding-service')`, emitting structured JSON logs that flow into the monitoring service.
- Funnel analytics are captured by `recordOnboardingEvent` and surfaced via `OnboardingFunnelMetrics.tsx`; product analytics can export this via SQL without instrumenting multiple code paths.
- Contract tests live in `services/onboarding/src/__tests__` (wizard schema, sample data, etc.) and end-to-end coverage appears in `__tests__/e2e/accountantWorkflow.test.ts` where onboarding is the opening act.
- The wizard and orchestrator are fully tenant-scoped, and PII is only ever stored server-side with the shared encryption utilities from `@ai-accountant/shared-utils`.

**File name:** `PHASE1_FULL_IMPLEMENTATION.md`
