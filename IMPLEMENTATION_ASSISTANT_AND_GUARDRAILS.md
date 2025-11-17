# Implementation Playbook – Assistant Intelligence, Tooling & Guardrails

## Objective
Transform the assistant into a trustworthy co-pilot that reasons over ledgers, filings, and documents with verifiable answers, structured actions, and compliance-grade guardrails.

## Scope
- Tool-enabled agentic workflows (ledger queries, reconciliation actions, filing prep, scenario planning).
- Retrieval upgrades (multi-vector, structured context, temporal awareness) and hallucination defenses.
- Evaluation harnesses aligned to accounting accuracy KPIs with automated reporting.

## Backend Workstreams
### 1. Tooling & Function Calling
- Define schema-driven tools (TypeScript interfaces) for ledger queries, posting journal entries, running tax calculators, fetching reconciliation status, initiating filings.
- Upgrade assistant service to use OpenAI function calling (or Azure GPTs) with deterministic tool routing, sandbox vs prod modes, and rate limits per tenant.
- Persist `assistant_actions` with inputs/outputs, approvals, and rollback metadata.

### 2. Retrieval & Context Engine
- Build multi-store retriever: structured ledger store (Postgres), vector store (Chroma/Pinecone), and rulepack metadata; use hybrid retrieval with ranking.
- Add temporal context (e.g., limit to current filing period) and role-aware filters (accountant vs client) to avoid leaking unrelated data.

### 3. Guardrails & Compliance
- Implement policy engine (Rebuff/Gandalf-style) that checks prompts/responses for prohibited actions, PII leakage, or unsupported claims.
- Require dual confirmation for irreversible actions (filing submission, payment initiation) with audit logging + MFA.
- Provide “explain my answer” endpoint returning chain-of-thought summary, citations, and validation checks (numbers tie to ledger totals).

### 4. Evaluation & Monitoring
- Expand evaluation dataset (questions → expected structured answers) categorized by domain (VAT, reconciliation, forecasting, compliance).
- Automated eval runner after each model/prompt change; store metrics (BLEU, factuality, groundedness) and alert on regressions.
- In-production monitoring: sample % of conversations for human review, capture user feedback (thumbs up/down) feeding into retraining.

## Frontend Workstreams
### Assistant Workspace
- Conversational UI with context summary (tenant, period, open tasks) and quick actions (Generate VAT pack, Reconcile account, Explain variance).
- Inline citations with hover cards showing source docs/ledger entries; ability to open referenced doc in side panel.
- Approval modals for assistant-initiated actions (journal post, filing prep) showing diff, confidence, and required reviewer comments.

### Compliance Mode UX
- Dedicated view for regulators/auditors with immutable conversation transcripts, tool action logs, and reasoning summaries.
- “Explain this filing” feature that traces every box to source entries.

## Metrics & Acceptance
- Assistant factual accuracy ≥ 98% on golden eval set; zero unanswered compliance questions with verified citations.
- 95% of tool calls succeed without manual retry; action approval latency <2 minutes.
- Guardrail violations <0.1% of conversations, with automatic incident tickets.

## Dependencies & Sequencing
1. Define tool schemas + action logging.
2. Upgrade retrieval + guardrails.
3. Build frontend workspace & approval UX.
4. Launch evaluation harness + monitoring dashboards.
