# Phase 3 – Compliance Brain (Full Implementation)

Phase 3 elevates the product from “books in order” to a compliance-grade system of record with rulepacks, filings, and explainability. Below is the implemented footprint across UI, services, and data.

---

## 1. Experience Surfaces (Web)

- **Audit-friendly consoles**
  - `apps/web/src/components/ComplianceMode.tsx` (rendered via `app/compliance/page.tsx`) gives auditors immutable transcripts, tool-action logs, filing explanations, and conversation replay. It calls `/api/assistant/actions/logs`, `/api/assistant/conversations/:conversationId`, and `/api/assistant/filings/:filingId/explain`.
  - `ComplianceEvidenceDashboard.tsx`, `ComplianceWarning.tsx`, `ReadinessDashboard.tsx`, and `ComplianceCalendar.tsx` visualize readiness scores, active obligations, and evidence packages fetched from `/api/compliance/*` plus `/api/monitoring/slos`.
  - `AccountantPortal.tsx` aggregates filing workflows, approvals, and outstanding attestations so firms can supervise multiple tenants.
- **Frontline guidance**
  - `ComplianceWarning.tsx` injects readiness banners inside other modules (assistant, filings) using the same readiness API used by compliance mode.
  - `ReadinessDashboard.tsx` highlights connectors, unmatched transactions, and validation blockers pre-filing.

All compliance experiences are client components with built-in polling, optimistic updates, and locking when transcripts are viewed (to preserve immutability).

---

## 2. Assistant + Guardrails

- `services/assistant/src/routes/assistant.ts` exposes `/compliance/query`, `/filings/:id/explain`, `/actions/logs`, `/actions/:id/(approve|reject)`, and `/evaluations/run` endpoints that the UI consumes.
- `services/assistant/src/services/complianceMode.ts` enriches prompts with obligations, readiness, rulepacks, and filing history by querying:
  - `compliance/src/services/complianceCalendar`
  - `filing/src/services/filingLifecycle`
  - `rules-engine/src/services/rulepackDSL`
  - `filing_explanations`, `filing_ledger`, `rulepack_catalog`
- `guardrailService` (`services/assistant/src/services/guardrails.ts`) enforces policy:
  - Prompt gating (prohibited actions, PII detection)
  - Response validation (no unsupported claims, chain-of-thought capture)
  - Tool call validation (filing submission state checks, large-amount alerts)
  - Violation logging via `audit_logs`
- Function calling (`services/assistant/src/services/functionCalling.ts`) wraps compliance-aware tools (`generate_filing_draft`, `get_rule_explanation`, `post_journal_entry`, etc.) so AI responses include actionable data plus citations traced back to rulepacks.

---

## 3. Rule Engine & Filings

| Component | Highlights |
| --- | --- |
| Rules Engine | `services/rules-engine` includes jurisdiction packs (`ukTax`, `ukVATCalculations`, `ukHMRCIntegration`, `usTaxSystem`, etc.), the DSL compiler (`rulepackDSL.ts`), and git-backed registry management (`rulepackGitRepository.ts`). Rulepacks are versioned and stored in `rulepack_catalog`. |
| Filing lifecycle | `services/filing/src/services/deadlineManager.ts`, `filingLifecycle.ts`, and `filingReviewWorkflow.ts` orchestrate readiness, draft creation, checklist generation, attestation, and submission. Deadline calculations account for VAT, PAYE, Corporation Tax, etc., and integrate with `notificationManager`. |
| HMRC adapter | `packages/hmrc/src/index.ts` ships OAuth token exchange, obligations queries, and VAT return submission helpers so filings can hit MTD APIs once credentials are present. |
| Multi-jurisdiction | `services/multi-jurisdiction` + `services/compliance` provide calendar, mapper, and scenario planner helpers for EU/US/CA coverage, feeding the readiness APIs. |

Every filing stores metadata in `filings`, ledger-aligned data in `filing_ledger`, explanations in `filing_explanations`, and review records in `filing_reviews`. Explanations power the “Explain Filing” button in Compliance Mode.

---

## 4. API Contracts & Data Flow

1. **Compliance context**: `/api/assistant/compliance/query` → `complianceModeService.getComplianceContext` → `complianceCalendarService.getUpcomingDeadlines` + `rulepack_catalog` + `filing_ledger`.
2. **Readiness**: `/api/compliance/calendar` + `/api/compliance/readiness` pull from `compliance/src/services/complianceCalendar` (which piggybacks on bank health, validation findings, connector status).
3. **Filing creation**: `handleFilingPreparationCommand` inside `complianceModeService` validates readiness, derives period start/end, and calls `filingLifecycleService.createDraft`. Draft metadata is persisted and returned to the assistant + UI.
4. **Explainability**: `/api/assistant/filings/:id/explain` fetches `filing_explanations` rows (calculation steps, rule references) so both the assistant and Compliance Mode render line-item justifications.
5. **Auditing**: Every compliance action writes to `audit_logs` with resource types such as `guardrail_violation`, `assistant_action`, and `filing_review`.

---

## 5. Evidence & Reporting

- Evidence uploads are tracked in `compliance_evidence` and surfaced via `ComplianceEvidenceDashboard.tsx`.
- `/api/compliance/evidence` aggregates controls per framework (SOC 2, ISO 27001, GDPR) so the Trust Dashboard can show certification status.
- `services/analytics` enriches compliance reports with predictive signals (e.g., trend detection in filings) for the assistant and dashboards.

---

## 6. Testing & Monitoring

- Regression coverage: `__tests__/e2e/worldClassWorkflows.test.ts` walks through document quality control → duplicate detection → filing review → approval → readiness cross-validation.
- Integration tests: `services/filing/src/__tests__` and `services/rules-engine/src/__tests__` verify calculations for VAT, PAYE, corporation tax scenarios.
- Monitoring hooks:
  - Deadline reminders are logged via `notificationManager.createNotification`.
  - Guardrail violations emit warning logs and audit rows.
  - Compliance APIs leverage `createLogger('assistant-service')` / `createLogger('filing-service')` so Datadog/Grafana dashboards can alert on elevated error rates.

**File name:** `PHASE3_FULL_IMPLEMENTATION.md`
