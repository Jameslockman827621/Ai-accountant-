# Phase 1 – Clarity Onboarding

Comprehensive blueprint for delivering an intent-aware onboarding experience that configures the AI accountant for every UK/US/CA user the moment they sign up.

---

## Mission & Definition of Done
- Capture each customer’s business context, jurisdictions, obligations, source systems, and success metrics during activation.
- Provision a ready-to-use workspace (chart of accounts, calendars, AI memory, connectors) without human intervention.
- Establish trust signals (KYC, compliance disclosures, consent records) so downstream automations can execute confidently.

**Exit Criteria**
1. 95% of new tenants complete onboarding in <10 minutes without internal assistance.
2. Every tenant has a populated intent profile, mapped filings, and enabled connectors (or an actionable task list).
3. AI assistant references the collected intent in its reasoning traces and recommended actions.
4. Security, consent, and audit artifacts stored for each onboarding session.

---

## User Journeys
1. **Freelancer (UK VAT registered)** – signs up, connects HMRC MTD, sets quarterly VAT schedule, uploads historic invoices.
2. **US e-commerce SMB** – invites bookkeeper, connects Plaid + Shopify, declares sales-tax nexus states, requests AI cash-flow guardrails.
3. **Canadian accountant with multiple clients** – creates firm workspace, spins up client tenants, defines review SLAs, assigns staff.

Each journey must support web and mobile capture, progressive disclosure, and immediate confirmation emails summarizing configured obligations.

---

## Capability Stack

### Experience Layer
- Responsive onboarding wizard (Next.js) with save/resume, contextual help, and AI copilot suggestions.
- Intent questionnaire covering: entity type, jurisdictions, fiscal calendar, VAT/sales tax registrations, payroll, e-commerce, banking, accounting method, goals.
- KYC & compliance checks (document upload, identity verification via vendor such as Persona/Onfido).
- Connector selection & authorization screens with guided flows (Plaid, TrueLayer, HMRC OAuth, IRS e-Services, CRA MyBA, Shopify, Stripe).
- Success plan dashboard summarizing “Here is what your AI accountant will do next” plus optional human concierge booking link.

### Backend & Services
- Extend `auth-service` to support organization/firms, invitations, and role templates (Owner, Accountant, Staff, Auditor).
- New `onboarding-orchestrator` module (could live inside API gateway) maintaining state machine for each tenant.
- Event-driven tasks to provision chart of accounts (templates per industry), filing calendars, notification preferences, and AI memory documents.
- KYC microservice integration: store verification tokens, handle retries/escalations, link to compliance logs.

### Data & Models
- **Intent Profile Schema**: entity metadata, jurisdictions, registration numbers, fiscal calendar, connected systems, goals, risk tolerance.
- **Consent Ledger**: records of every authorization (banking, tax authority, data sharing) with expiry reminders.
- **Connector Registry**: tracks required vs. enabled connectors, credential health, token rotation tasks.
- **AI Memory Documents**: structured embeddings describing tenant goals, key contacts, and obligations injected into assistant context.

### AI & Automation
- Natural-language questionnaire assistant that clarifies ambiguous answers and pre-populates fields from uploaded documents.
- Intent summarizer service that turns questionnaire + uploads into a canonical “Reason for joining” narrative (stored in vector DB).
- Risk scoring model to determine whether to enforce human review before automation (based on business type, revenue, compliance history).

### Security & Compliance
- Enforce MFA from first login, capture audit logs for every onboarding step, and store PII encrypted at rest (KMS-backed).
- Document GDPR/CCPA consent flows, expose data usage statements, and provide downloadable onboarding summary.
- Implement least-privilege scopes for each connector; rotate credentials immediately upon completion.

### Monitoring & CX
- Track funnel metrics (drop-off per step, connector completion rate).
- Real-time alerts when KYC fails, HMRC tokens expire, or required answers missing.
- Qualitative feedback capture after onboarding to feed CSAT dashboards.

---

## Deliverables Checklist
1. **UX assets**: Figma flows, content guidelines, microcopy with localization plan (en-GB, en-US, en-CA).
2. **API contracts**: `/onboarding/sessions`, `/intent-profile`, `/connectors/{id}/authorize`, `/kyc/verify`.
3. **Data migrations**: new tables for intent profiles, consent ledger, connector registry, AI memory.
4. **State machine implementation** with retry/backoff, idempotent steps, and recovery UI.
5. **KYC integration** (sandbox + production), including webhook handling and manual override tooling.
6. **Connector SDK wrappers** with secret management via Vault or AWS KMS-backed store.
7. **AI prompt templates** for questionnaire copilot + intent summarizer.
8. **QA plan**: accessibility audit, localization testing, load tests (1k concurrent onboardings), penetration test on onboarding endpoints.

---

## Work Packages & Sequencing
1. **Foundation (Week 1-2)**  
   - DB migrations, intent profile schema, consent ledger, connector registry tables.  
   - Service contracts, onboarding state machine skeleton, audit logging hooks.
2. **Experience Build (Week 2-4)**  
   - Wizard UI, autosave, validation, AI copilot integration, localization scaffolding.  
   - Email templates for confirmations + task reminders.
3. **Integrations (Week 3-5)**  
   - KYC vendor integration + admin override tool.  
   - HMRC OAuth + Plaid/TrueLayer connectors with secure credential storage.  
   - IRS/CRA authorization placeholders with mock sandboxes.
4. **Automation Hooks (Week 4-6)**  
   - Chart-of-accounts provisioning, filing calendar generation, AI memory ingestion.  
   - Event bus notifications to downstream services (ledger, rules engine, assistant).
5. **Validation & Launch (Week 6-7)**  
   - Golden-path + edge-case testing, CX dry runs, instrumentation dashboards, launch checklist.

---

## Success Metrics
- Onboarding completion rate ≥ 90%.
- ≥ 80% of tenants authorize at least one financial connector during onboarding.
- AI assistant references intent profile in ≥ 95% of initial conversations.
- Support tickets related to onboarding < 3% of new tenants.

---

## Risks & Mitigations
- **Connector authorization fatigue** → Provide “defer” paths with auto-reminders and highlight minimal set required for automation.
- **KYC false positives** → Implement manual review SLAs and automated escalation playbooks.
- **Localization gaps** → Build translation pipeline early and include locale toggles in QA plan.
- **PII exposure** → Enforce field-level encryption, data retention limits, and masking in logs.

---

## Handoffs & Dependencies
- Requires security team to provision Vault/KMS access before connector rollout.
- Compliance/legal sign-off on consent copy and record retention.
- Coordination with AI/ML team for intent summarizer prompts + evaluation set.

This artifact should be treated as the authoritative execution script for AI agents and engineers delivering Phase 1.
