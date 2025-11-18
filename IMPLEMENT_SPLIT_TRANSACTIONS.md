# Reconciliation Split Transactions – World‑Class Implementation Blueprint

## 1. Problem Statement
- Accountants frequently receive aggregated bank transactions (batch payouts, combined deposits, expense card settlements) that must be allocated across several invoices or ledger entries.
- The current reconciliation cockpit (`apps/web/src/components/ReconciliationCockpit.tsx`) cannot split transactions; `splitTransaction()` simply alerts “coming soon.” Users must leave the product to adjust CSVs manually, creating audit risk and delaying close.
- Backend (`services/reconciliation`) supports only 1:1 matches via `reconcileTransaction`. There is no persistence model, API, or workflow for partial matches, exception handling, or audit logging of split allocations.

## 2. Goals & Success Metrics
| Goal | KPI / Target |
| --- | --- |
| Enable precise allocation of aggregated bank transactions across multiple documents/entries | 95% of multi-invoice payouts reconciled within the product |
| Preserve auditability & controls | 100% of splits logged with actor, timestamp, rationale |
| Maintain performance | < 300 ms API latency (P95) for split CRUD, < 1s UI actions |
| Delight accountants | NPS improvement for reconciliation module (+5 points) backed by qualitative interviews |

## 3. Functional Requirements
1. **Create/Edit/Delete Split Lines**
   - Users can create up to 50 splits per bank transaction.
   - Each split includes: amount, currency (defaulted from transaction), optional document ref, optional ledger entry, memo, tags.
   - Running balance indicator shows “Remaining amount” in real time.
   - Validation ensures sum of active splits equals bank transaction total before commit.
2. **Auto-Suggest Split Candidates**
   - For each split row, user can search documents/entries via existing `/matches/:transactionId` endpoint filtered by amount thresholds.
   - Provide quick actions (“Allocate evenly”, “Use historical pattern” based on prior splits for same vendor).
3. **State Transitions**
   - `draft` (in progress) → `pending_review` (optional two-person control) → `applied`.
   - Configurable approval requirement per tenant; integrate with workflow service if approval is enabled.
4. **Audit & Controls**
   - Every action writes to `audit_logs` with diff (old/new amount, target doc, user, IP).
   - Splits support attachments/notes for supporting evidence.
5. **Exception Handling**
   - If a split is applied but ledger posting fails, system rolls back to `draft` and raises reconciliation exception.
6. **UX polish**
   - Badges (Split, Partially matched) on transaction rows.
   - Keyboard shortcuts to add/remove rows.
   - Accessible form fields (WCAG 2.1 AA).

## 4. Architecture & Data Model
### 4.1 New Table: `transaction_splits`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID PK |
| `tenant_id` | UUID FK (tenants) |
| `bank_transaction_id` | UUID FK (bank_transactions) |
| `status` | enum (`draft`, `pending_review`, `applied`, `void`) |
| `split_amount` | numeric(18,4) |
| `currency` | char(3) |
| `document_id` | UUID FK (documents) nullable |
| `ledger_entry_id` | UUID FK (ledger_entries) nullable |
| `memo` | text |
| `tags` | jsonb |
| `confidence_score` | numeric(5,4) optional |
| `created_by` / `updated_by` | UUID |
| timestamps |

### 4.2 Derived Fields on `bank_transactions`
- `is_split` (boolean)
- `split_remaining_amount` (numeric)
- `split_status` (enum `not_split`, `in_progress`, `balanced`, `applied`)

### 4.3 Services & Modules
- `transactionSplitRepository` (CRUD, locking).
- `splitAllocationService` (validation, aggregate updates, workflow triggers).
- `splitReconciliationService` (invokes existing `reconcileTransaction` per split, ensures atomicity).

## 5. API Design (services/reconciliation)
| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/reconciliation/splits/:transactionId` | GET | List splits + remaining amount |
| `/api/reconciliation/splits` | POST | Create/replace split set (accepts array) |
| `/api/reconciliation/splits/:splitId` | PUT | Update memo/document reference/amount (draft only) |
| `/api/reconciliation/splits/:splitId` | DELETE | Remove split (draft) |
| `/api/reconciliation/splits/:transactionId/submit` | POST | Move to `pending_review` or apply if approvals disabled |
| `/api/reconciliation/splits/:transactionId/approve` | POST | Approver finalizes; triggers posting |
| `/api/reconciliation/splits/:transactionId/reject` | POST | Reviewer rejects with reason |

### Request Contracts
```json
POST /api/reconciliation/splits
{
  "transactionId": "uuid",
  "splits": [
    {
      "tempId": "client-generated uuid",
      "amount": "120.45",
      "currency": "GBP",
      "documentId": "uuid | null",
      "ledgerEntryId": "uuid | null",
      "memo": "May SaaS payout",
      "tags": ["Stripe", "Subscription"],
      "confidenceScore": 0.92
    }
  ]
}
```

## 6. Frontend Implementation (Next.js / Tailwind)
1. **Split Drawer Component**
   - Create `SplitTransactionDrawer.tsx` housing:
     - Transaction summary (vendor, date, total, existing matches).
     - Editable table (amount, target, memo, actions).
     - Summary footer showing “Allocated vs Remaining”.
   - Use `react-hook-form` with field arrays for robust validation.
2. **Integration Points**
   - `ReconciliationCockpit`:
     - Add “Split” CTA for eligible transactions.
     - Display aggregated status in list row.
   - Possibly update `BankTransactionDetailsPanel` if exists.
3. **State & Data Hooks**
   - `useTransactionSplits(transactionId)` hook to load/update splits via SWR or React Query for caching and optimistic updates.
4. **Error UX**
   - Inline error rows when backend rejects (e.g., concurrency conflict, currency mismatch).
   - Gracefully handle 409 (transaction updated elsewhere) by refetching.
5. **Accessibility & UX polish**
   - Keyboard nav (Tab, Enter to add row, Shift+Delete to remove).
   - Screenreader labels for sums and row-level errors.
   - Dark mode support if rest of dashboard supports it.
6. **Testing**
   - Unit tests for `SplitTransactionDrawer` verifying validation.
   - Cypress/Playwright scenario: open drawer, add 3 splits, submit, ensure table updates.

## 7. Backend Implementation Steps
1. **Migrations**
   - Add `transaction_splits` table + new columns on `bank_transactions`.
   - Update views/materialized reports if referencing totals.
2. **Repositories & Services**
   - Implement `TransactionSplitRepository` with methods:
     - `findByTransaction(tenantId, transactionId)`
     - `upsertSplits(tenantId, transactionId, splits, actorId)` (wrapped in DB transaction, `FOR UPDATE` on bank transaction row)
     - `deleteSplit(...)`
   - `SplitAllocationService` handles validation (sum check, currency, duplicates).
   - `SplitApprovalService` integrates with workflow service if approvals enabled.
3. **Reconciliation Engine**
   - Update `reconcileTransaction` to accept arrays or new service `applySplits` to loop through splits:
     - For each split: call existing posting pipeline, attach metadata indicating split origin.
     - Ensure partial failures rollback entire batch (DB transaction + saga pattern if external calls).
4. **Events & Notifications**
   - Emit events (`reconciliation.split.applied`, etc.) via RabbitMQ for downstream analytics.
   - Send notification to reviewers when splits submitted (reuse notification service).
5. **Performance & Concurrency**
   - Use optimistic locking (version column) or DB locks to prevent overlapping edits.
   - Index `transaction_splits` on (`tenant_id`, `bank_transaction_id`).
6. **Observability**
   - Metrics: number of splits created, average splits per transaction, time-to-approval.
   - Log structured data for each state change.
7. **Security**
   - Enforce RBAC: only users with `accountant` or custom permission can edit splits; reviewers need `review_split` permission.
   - Validate tenant IDs at every layer.
8. **Testing**
   - Unit tests for validation logic (sum mismatch, currency mismatch).
   - Integration tests building on existing `ledger-reconciliation` suite:
     - Scenario: create splits → apply → verify ledger entries + bank transaction status.
   - Load tests with synthetic data to ensure DB operations scale (simulate 10k splits).

## 8. Deployment & Rollout
1. **Feature Flag**
   - Introduce `RECON_SPLITS_ENABLED` (per-tenant toggle). Default off in production until pilot tenants vetted.
2. **Data Backfill**
   - For existing partially reconciled transactions, set `is_split = false` initially; migration script can backfill if spreadsheets exist.
3. **Docs & Training**
   - Update help center article + in-app walkthrough (coach marks) when feature turns on.
4. **Pilot & Gradual Rollout**
   - Stage 1: internal QA & accounting SMEs.
   - Stage 2: pilot accounting firms (3–5 tenants).
   - Stage 3: GA after collecting feedback + metrics.

## 9. Open Questions / Decisions Needed
1. Should split lines support tax codes (VAT allocation) or rely on document-level tax? (Likely yes; need product decision.)
2. For multi-currency: do we allow splits in mixed currencies? Proposed approach: require same currency as bank transaction; for others, force creation of FX adjustment entry.
3. Approval workflow: Should it integrate with existing workflow service or have dedicated lightweight approvals? (Recommendation: reuse workflow service for consistency.)
4. Auto-allocation rules: we scoped basic suggestions—future phase could learn from historical splits via ML.

## 10. Timeline & Work Breakdown (estimates)
| Workstream | Owner | Est. Time |
| --- | --- | --- |
| DB migrations + repositories | Backend | 3 days |
| Split services & API endpoints | Backend | 4 days |
| Reconciliation engine updates | Backend | 3 days |
| Frontend drawer + UX polish | Frontend | 5 days |
| Approvals + notifications integration | Backend/Full-stack | 2 days |
| Testing (unit, integration, e2e) | QA/Eng | 4 days |
| Docs, rollout, feature flagging | PM/Enablement | 2 days |

## 11. Acceptance Criteria
- ✅ Users can create/edit/delete splits, with validation preventing imbalance.
- ✅ Applying splits posts ledger entries, reduces remaining amount to zero, and marks transaction reconciled.
- ✅ Audit log shows full history including approvals.
- ✅ Attempting to split an already fully reconciled transaction returns 409.
- ✅ Automated tests cover happy path + error scenarios; CI green.
- ✅ Monitoring dashboard shows split metrics; alerts fire on repeated failures.

Once these deliverables are met, the split-transaction experience will be world-class—fast, controlled, auditable, and pleasant for accountants tackling complex reconciliations.

