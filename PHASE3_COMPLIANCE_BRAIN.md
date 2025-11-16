# Phase 3 – Compliance Brain

Deliver a jurisdiction-aware compliance and filing engine that reasons over deterministic rulepacks and orchestrates submissions for UK, US, and Canadian customers.

---

## Mission & Definition of Done
- Encode tax and payroll obligations across UK, USA, and Canada with maintainable, testable rulepacks tied to authoritative sources.
- Automate filing preparation, approval workflows, submission, and acknowledgement storage for priority returns (UK VAT, PAYE, Corporation Tax; US sales tax + federal income filings via partners; Canadian GST/HST/QST + payroll).
- Provide transparency: every calculation, assumption, and filing must be explainable, traceable, and reversible.

**Exit Criteria**
1. Rulepack coverage for core filings listed above with versioning, regression tests, and change logs.
2. Filing service can generate drafts, route for approval, submit to APIs/sandboxes, and store acknowledgements + artefacts.
3. Compliance calendar auto-populated with obligations per tenant; readiness scores updated daily based on data completeness.
4. Assistant cites rule IDs and filing context when answering compliance questions.

---

## Capability Stack

### Rulepacks & Knowledge Base
- **Rulepack DSL** supporting deterministic calculations (rates, thresholds, proration), conditional logic, and references to statutory docs.
- Version registry (semantic versioning, effective dates, status) with Git-backed storage, code reviews, and automated documentation generation.
- Test harness: golden datasets per jurisdiction, scenario-based tests, fuzzing for thresholds, and rollback workflows.
- Integration with RAG corpus so assistant responses link to rule IDs and interpretive guides.

### Filing Service
- Microservice handling filing lifecycle: obligation discovery, eligibility checks, data hydration, draft generation, approvals, submission, acknowledgement.
- Adapters:  
  - **UK**: HMRC MTD VAT (obligations, liabilities, submission, payments), PAYE RTI submissions, Corporation Tax (MTD pilot).  
  - **US**: Sales tax via partners (e.g., TaxJar/Avalara APIs), federal income filings via third-party e-file gateway, state nexus tracking.  
  - **Canada**: CRA GST/HST, Revenu Québec QST, payroll remittances.
- Sandbox simulators for each adapter to support CI, contract tests, and demo environments.

### Workflow & Approvals
- Multi-step approval policies (auto, accountant review, client sign-off) with digital signatures and immutable audit trail.
- Task assignments, reminders, escalation rules (e.g., no approval 48h before deadline → escalate).
- “Explain this filing” view showing source transactions, adjustments, rule decisions, AI commentary.

### Compliance Calendar & Readiness
- Calendar engine ingesting obligations from rulepacks + onboarding data; supports cadence changes, special filings, and jurisdiction-specific holidays.
- Readiness scoring: data completeness, reconciliation status, connector health, outstanding tasks.
- Alert feeds for upcoming deadlines, missing data, expiring authorizations.

### Assistant Enhancements
- Compliance-mode prompt templates referencing tenant intent, rulepack versions, upcoming obligations.
- Ability to draft filings via assistant command (“Prepare Q2 VAT return”), show preview, gather approvals.
- Self-check logic: assistant validates that data freshness + reconciliations meet thresholds before recommending submission.

### Data & Storage
- **Filing Ledger** storing drafts, submissions, acknowledgements, payment references, audit files, and attachments.
- **Rulepack Catalog** tables with metadata, dependencies, jurisdiction tags, effective periods.
- **Compliance Evidence Store** (S3) containing generated workpapers, calculation spreadsheets, signed approvals.

### Security & Compliance
- OAuth scopes for HMRC/IRS/CRA tokens; automatic refresh and revocation handling.
- PII minimization in logs; encryption-at-rest for filing data.
- Alignment with HMRC MTD security requirements, IRS Pub. 1075, CRA safeguarding guidelines.

### Observability
- Metrics: filings generated/submitted, success/failure rates, rulepack evaluation latency, approval times.
- Alerts: approaching deadlines without approvals, submission failures, rulepack regression failures.
- Tracing across rule evaluation → filing drafts → submission.

---

## Deliverables Checklist
1. Rulepack DSL spec, compiler/interpreter, and authoring tools (CLI + UI editor).
2. Jurisdiction rulepacks (UK VAT/PAYE/CT, US Sales Tax/federal income template, CA GST/HST/QST/payroll).
3. Filing service with adapter abstractions, sandbox connectors, and CI contract tests.
4. Compliance calendar UI, readiness summary, and notification hooks.
5. Approval workflow UI + API, including signature capture and audit log viewer.
6. Assistant compliance mode prompts, retrieval config, command schema for “prepare filing”.
7. Documentation: rulepack authoring guide, filing operations manual, API references.

---

## Work Packages & Sequencing
1. **Rulepack Platform (Week 1-3)**  
   - Design DSL, storage, versioning, CI pipeline, regression harness.  
   - Author UK VAT rulepack as reference implementation.
2. **Filing Service Core (Week 2-5)**  
   - Build lifecycle orchestration, filing ledger schema, approval integration, sandbox adapters.  
   - Deliver HMRC VAT adapter end-to-end (obligation fetch, draft, submit).
3. **Calendar & Readiness (Week 4-6)**  
   - Generate obligations per tenant, build readiness scoring engine, dashboards, notifications.
4. **Jurisdiction Expansion (Week 5-8)**  
   - Add PAYE, Corporation Tax, US sales tax, US federal income (partner), CA GST/HST/QST, payroll.  
   - Update assistant prompts + RAG contexts per jurisdiction.
5. **QA, Docs, Launch (Week 7-9)**  
   - Regression tests against golden dataset, mock audits, compliance sign-off, customer beta.

---

## Success Metrics
- Filing automation rate ≥ 70% (without manual adjustments) for supported filings.
- Submission success rate ≥ 99.5% with automatic retries and alerting.
- Rulepack regression suite coverage ≥ 95% of documented scenarios.
- Assistant compliance answers achieve CSAT ≥ 4.5/5 with citation accuracy ≥ 99%.

---

## Risks & Mitigations
- **Regulatory changes** → Establish change-monitoring process, subscribe to tax authority feeds, maintain hotfix pipeline.
- **Adapter downtime** → Sandbox testing, circuit breakers, queued submissions with exponential backoff.
- **Complex approvals** → Provide flexible policy builder and API for external approvals (e.g., Slack, email).
- **Liability exposure** → Require explicit customer acknowledgment for auto-submissions, maintain E&O insurance, provide audit packages.

---

## Dependencies & Handoffs
- Needs Phase 2 data completeness + reconciliation to ensure filings accurate.
- Legal/compliance review of rulepacks and adapter usage agreements.
- Coordination with finance team for filing payment workflows.
- Collaboration with AI/ML for assistant prompt updates and evaluation of compliance responses.

Use this guide as the authoritative execution document for building the Compliance Brain.
