# Reconciliation Split Transactions – Implementation Plan

## Overview
- Build full support for splitting a single bank transaction across multiple ledger entries/documents to resolve partial matches in the reconciliation cockpit.
- Current UI stub lives in `apps/web/src/components/ReconciliationCockpit.tsx` and simply shows an alert (`splitTransaction()`), so accountants cannot clear partially matched transactions.
- Service layer (`services/reconciliation`) only allows single `bankTransactionId` ⇒ `documentId|ledgerEntryId` matches; there is no API to create/update split allocations.

## Frontend Scope (Next.js dashboard)
1. **UI affordance**
   - Replace the `alert('Split transaction feature coming soon')` stub with a modal or drawer that:
     - Lists the selected bank transaction details + amount.
     - Allows adding multiple split rows (amount, target document/ledger entry, memo, confidence).
     - Validates that the sum of split amounts equals the transaction total (show remaining amount indicator).
     - Supports attachment lookup (search existing documents/ledger entries via existing `/api/reconciliation/matches/:transactionId` endpoint) or manual ledger entry creation (optional future).
   - Highlight splits visually in the transaction list (badge “Split”).
2. **State management**
   - Extend local state to cache splits fetched from backend (`GET /api/reconciliation/splits/:transactionId`).
   - After saving, optimistically update the transaction’s status counters (reconciled/suggested) to keep dashboard KPIs accurate.
3. **API integration**
   - Add `POST /api/reconciliation/splits` + `PUT /api/reconciliation/splits/:splitId` + `DELETE …` calls via `fetch` helper.
   - Handle backend validation errors (e.g., sum mismatch) and expose them inline near split rows.
4. **Testing**
   - Add React Testing Library test that ensures the modal enforces sum = total and calls the API with structured payload.
   - E2E test (Playwright `__tests__/e2e/ledger-reconciliation.test.ts`) covering creation + reconciliation of a split transaction.

## Backend Scope (services/reconciliation)
1. **Data model**
   - New table `transaction_splits` (tenant-scoped) storing:
     - `id`, `tenant_id`, `bank_transaction_id`, `split_amount`, `currency`, `document_id` nullable, `ledger_entry_id` nullable, `notes`, `status`, `created_by`, timestamps.
   - Migration in `services/database/src/migrations` + typed accessors in `transactionSplitRepository`.
2. **API layer**
   - Routes under `routes/reconciliation.ts`:
     - `GET /splits/:transactionId` – list splits (filtered by tenant).
     - `POST /splits` – create splits in a single tx; validates total equals bank transaction amount, prevents overlap with fully reconciled state.
     - `PUT /splits/:id` – update allocations/notes prior to final reconciliation.
     - `DELETE /splits/:id` – remove a split (re-open transaction amount).
     - `POST /splits/:id/apply` – finalize a split by creating ledger reconciliation entries (optional if reuse existing `reconcileTransaction` w/ array payload).
3. **Matching logic**
   - Update `matcher`/`reconcileTransaction` to accept payload `{ splits: Array<{ splitId | tempId, documentId | ledgerEntryId, amount } > }`.
   - Ensure anomaly detection + exception workflows treat split children as individual reconciliation events (update `reconciliation_events` insert logic).
4. **Bank transaction status**
   - Add derived fields: `split_remaining_amount`, `is_split` boolean for UI.
   - Adjust existing `findMatches` to consider remaining amount per split when suggesting matches.
5. **Validation & audit**
   - Enforce currency consistency between bank transaction and splits (use exchange rates if cross-currency support is enabled).
   - Write audit entries (`audit_logs`) whenever splits are created/modified (include actor + diff).
6. **Testing**
   - Unit tests for repository + service validations.
   - Extend `__tests__/integration/ledger-reconciliation.test.ts` to cover multi-split workflows (create splits ⇒ reconcile ⇒ ensure remaining amount zero).
7. **Performance/locking**
   - Wrap create/update/delete in DB transaction with `SELECT … FOR UPDATE` on the bank transaction row to avoid race conditions when multiple accountants edit the same transaction.

## Infrastructure / DevOps
- Apply migration (`npm run db:migrate`).
- Add feature flag/env (e.g., `ENABLE_RECON_SPLITS`) to gate release.
- Update API Gateway mapping if new routes added (already proxies `/api/reconciliation`, no extra work).

## Risks / Open Questions
- How to handle taxes/fees automatically when a split is created? Need UX guidance.
- Should splits permit both documents and manual ledger entries simultaneously? (Design decision).

