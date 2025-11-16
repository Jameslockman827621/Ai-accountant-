# Plan: Tax Intelligence, Filing & AI Advisor

Each chunk is scoped for an AI coding tool to complete with backend + frontend deliverables.

---

## Chunk 1 — Rulepack Lifecycle & Multi-Jurisdiction API

**Goal**  
Operationalize tax rulepacks for UK, US (federal + state), EU VAT, Canada, Mexico with versioning, approvals, and API exposure.

**Backend Spec**
- Create `rulepack_registry` table storing jurisdiction, version, status, checksum, effective dates.
- Build CLI + REST endpoints to install/activate rulepacks (`POST /api/rulepacks`, `PATCH /api/rulepacks/:id/activate`).
- Add regression runner referencing `regressionTests` defined per pack; store results in `rulepack_regression_runs`.
- Expose `/api/tax/:jurisdiction/calculate` that routes to correct service (VAT, income tax, payroll) using active rulepack.
- Implement RBAC guard so only compliance admins can promote rulepack versions.

**Frontend Spec**
- Add “Rulepack Manager” admin screen listing jurisdictions, current version, test status, and action buttons (run regression, promote, rollback).
- Provide diff viewer showing rule metadata changes between versions.
- Surface jurisdiction selector in dashboard analytics + assistant context to confirm which rules apply.

**Acceptance Criteria**
- Enabling a new jurisdiction requires uploading rulepack JSON + regression fixtures; activation blocked until tests pass.
- API consumers can hit `/api/tax/us-ca/calculate` and receive deterministic output based on active rulepack metadata.

---

## Chunk 2 — Filing Control Tower & Connectors

**Goal**  
Automate filings for VAT, GST/HST, US sales tax, PAYE, payroll, with full lifecycle (draft → review → submission → receipt).

**Backend Spec**
- Extend filing service with connector adapters: HMRC (existing), IRS Modernized e-File proxy, CRA GST/HST API, state sales tax aggregator (TaxJar/Avalara), payroll (Gusto, ADP).
- Implement `filing_workflows` table capturing statuses (draft, ready_for_review, approved, submitted, failed, amended).
- Add scheduler that looks at `filing_calendars`, generates drafts, attaches supporting evidence, and assigns review tasks.
- Store government receipts + confirmation payloads in object storage with hash verification.
- Provide `/api/filings/:id/audit-trail` endpoint enumerating every status change, user, model version.

**Frontend Spec**
- Build `FilingControlTower` page summarizing obligations per jurisdiction, readiness score, blocking issues, action buttons.
- Add review UI where accountants see draft numbers, supporting documents, AI explanations, and approve/reject with comments.
- Provide filing detail view with timeline (generated → reviewed → submitted → accepted) and download links for receipts.

**Acceptance Criteria**
- For supported jurisdictions, drafts appear automatically ahead of due date, containing calculated amounts + audit evidence.
- Submitting from UI triggers real API call, updates status, stores receipt, and surfaces success/failure instantly.
- Audit trail exports to CSV/PDF for regulator review.

---

## Chunk 3 — AI Assistant with Tooling & Explanations

**Goal**  
Upgrade assistant to orchestrate tax analyses, trigger filings, reconcile discrepancies, and provide cited reasoning.

**Backend Spec**
- Replace single-call GPT usage with tool-enabled framework (OpenAI “responses” with tool calling or LangChain agent) exposing tools:
  - `getLedgerSlice`, `calculateTax`, `generateFilingDraft`, `getRuleExplanation`, `createTask`.
- Add conversation memory store referencing rulepack versions and document citations.
- Implement guardrails: policy checks before executing sensitive actions (e.g., filing submission requires approval token).
- Log every assistant action with prompt, response, tool args, result, and user confirmation in `assistant_audit_log`.

**Frontend Spec**
- Update `AssistantChat` to show structured responses: summary, cited paragraphs, actions (buttons) to apply changes.
- Display “Reasoning Trace” accordion listing each tool call and returned data.
- Add quick actions (e.g., “Draft VAT return”, “Explain GST variance”) that prefill prompts with tenant context.

**Acceptance Criteria**
- Assistant can answer jurisdiction-specific queries citing rule IDs + documents, and optionally trigger draft filings via explicit confirmation.
- Users can inspect reasoning trace, download citations, and reject/approve AI-suggested actions.

---

## Chunk 4 — Scenario Planning & Optimization

**Goal**  
Provide proactive insights—forecast tax liabilities, detect anomalies, recommend optimizations per jurisdiction.

**Backend Spec**
- Extend rules-engine service with `scenario_planner` module that simulates adjustments (revenue changes, expense timing, entity restructuring).
- Add `tax_optimization_jobs` queue; results stored in `tax_scenarios` table with metrics (savings, risk score).
- Integrate anomaly detection service scanning ledger + tax outputs daily; raise tasks via autopilot engine.
- Provide API `/api/tax/scenarios` for CRUD + execution.

**Frontend Spec**
- Build `ScenarioPlanner` UI where users tweak sliders (revenue, payroll, jurisdictions) and see projected liabilities + AI commentary.
- Add anomaly alerts panel summarizing detected issues, linking to supporting transactions and recommended fixes.
- Surface optimization recommendations in dashboard cards with “Apply playbook” CTA hooking into automation service.

**Acceptance Criteria**
- Running a scenario returns forecasts within 5 seconds and stores results for comparison.
- Anomaly alerts include confidence, impacted filings, and direct actions (create task, ignore).
