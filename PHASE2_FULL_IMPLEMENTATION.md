# Phase 2 – Data Gravity (Full Implementation)

Phase 2 converts raw financial evidence into normalized ledger activity. This file inventories the implemented UI surfaces plus the ingestion, extraction, banking, and reconciliation services that make the stream reliable.

---

## 1. Experience Surfaces (Web)

- **Document intake & review**
  - `apps/web/src/components/DocumentUpload.tsx`, `DocumentIntakePanel.tsx`, `EnhancedDocumentIntake.tsx`, and `DocumentReview.tsx` let users drag/drop files, view quality scores, and hand off documents between intake and review queues.
  - `DocumentReviewPanel.tsx`, `ReviewQueue.tsx`, and `DuplicateDetector.tsx` read from `/api/documents`, `/api/classification/review-queue`, and `/api/documents/:id/duplicates` so reviewers can triage low-confidence items without leaving the dashboard.
  - `QualityDashboard.tsx` visualizes OCR/quality stats using `/api/documents/quality` and highlights issues flagged by the backend `qualityAssessment` service.
- **Banking + reconciliation**
  - `BankConnectionsPanel.tsx`, `EnhancedConnectionHealth.tsx`, `BankConnectionHealth.tsx`, and `UnifiedConnectionsPanel.tsx` consume `/api/bank-feed/connections` and `/api/bank-feed/health` to show token status, upcoming expiries, and retry progress.
  - `ManualTransactionImport.tsx` supports CSV uploads mapped to `/api/bank-feed/manual-import`.
  - `ReconciliationCockpit.tsx`, `ReconciliationDashboard.tsx`, `ReconciliationReport.tsx`, and `ExceptionQueue.tsx` orchestrate ledger/bank variance remediation by hitting `/api/reconciliation/*` plus the validation service.
- **Data observability**
  - `QualityChecker.tsx`, `GoldenDatasetReviewer.tsx`, and `ValidationDashboard.tsx` display anomaly, cross-validation, and golden dataset drift metrics so accountants see ingestion health in real time.

All of these components share the same API base (`NEXT_PUBLIC_API_URL`) and rely on bearer tokens so they can live inside the authenticated Next.js workspace.

---

## 2. Ingestion, OCR & Classification Services

| Layer | Implementation |
| --- | --- |
| Upload handling | `services/document-ingest/src/routes/documents.ts` and `storage/s3.ts` accept multipart payloads, stream them to S3/MinIO, and enqueue processing jobs on RabbitMQ via `messaging/queue.ts`. |
| OCR | `services/ocr/src/processor.ts` detects PDFs vs. raster images, runs `pdf-parse` or `tesseract.js` + `sharp`, and emits extracted text back to document-ingest. |
| Classification | `services/classification/src/services/qualityAssessment.ts`, `duplicateDetection.ts`, `documentReview.ts`, and `reviewQueueManager.ts` compute quality scores, flag duplicates, and route low-confidence documents to `document_review_queue`. |
| Guidance & versioning | `services/document-ingest/src/services/documentVersioning.ts` tracks re-uploads, while `guidanceService.ts` surfaces contextual instructions that the UI renders. |
| Messaging | `ProcessingQueues` (OCR / CLASSIFICATION / LEDGER) are asserted through `messaging/queue.ts`, giving each job a primary, retry, and DLQ for reliability. Metrics feed into the monitoring service via `recordQueueEvent`. |

Tests for parsing/dup detection live in `services/document-ingest/src/__tests__` and `__tests__/integration/fileUpload.test.ts`, ensuring the golden path works across binary uploads, queue hops, and database inserts.

---

## 3. Banking Pipelines

- `services/bank-feed` hosts connectors for Plaid, TrueLayer, and GoCardless along with a credential store (`connectionStore.ts`) backed by the shared secure-store utilities.
- `services/bank-feed/src/routes/bankFeed.ts` (and sibling routes) expose connection CRUD, sync initiation, and retry inspection endpoints consumed by the UI.
- `services/bank-feed/src/services/connectionHealthMonitor.ts` computes health scores, token-expiry countdowns, error counts, and recommendations; it powers the frontend health cards.
- `services/bank-feed/src/workers/retryWorker.ts` polls for failed syncs, locks rows, calls `syncPlaidTransactions` / `fetchTrueLayerTransactions`, and either marks retries as succeeded or re-schedules exponential back-off jobs.
- Data lands in `bank_transactions`, linked to ledger entries for downstream reconciliation, while audit inserts track every sync attempt for compliance review.

---

## 4. Reconciliation, Validation & Analytics

- `services/reconciliation/src/services/advancedMatching.ts`, `bankStatementMatching.ts`, and `matcher.ts` implement fuzzy matching (Levenshtein similarity, amount tolerances, date windows) so bank lines and ledger posts match even when descriptions differ.
- `services/reconciliation/src/routes/reconciliation.ts` and `reconciliationCockpit.ts` expose match suggestions, exception queues, and close workflows for the Next.js cockpit components.
- `services/validation/src/services/crossValidationEngine.ts`, `taxCalculationVerifier.ts`, `documentPostingValidator.ts`, and `validationSummary.ts` run post-ingestion checks (ledger vs. bank, VAT vs. filings, duplicate postings) and are surfaced via `ValidationDashboard.tsx`.
- Analytics hooks live inside `services/analytics/src/services/predictive.ts` and `enhancedForecasting.ts`, which query ledger entries to build ML-ready feature sets (RAG summarization, LLM prompts) used in the assistant and dashboards.

Integration + load tests under `__tests__/integration/reconciliation.test.ts`, `__tests__/integration/bankFeed.test.ts`, and `__tests__/e2e/worldClassWorkflows.test.ts` keep regressions from sneaking in.

---

## 5. Data Stores & Contracts

- Documents: `documents`, `document_versions`, `document_review_queue`, `document_quality_metrics`.
- Banking: `bank_connections`, `bank_sync_retries`, `bank_transactions`, `webhook_events`.
- Reconciliation: `reconciliation_jobs`, `reconciliation_matches`, `exception_queue`.
- Validation: `validation_runs`, `validation_findings`, `golden_dataset_results`.

All services share the `@ai-accountant/database` pool with tenant-scoped queries and explicit column lists to avoid wildcard leaks. Binary assets never touch application servers—they go straight to S3-compatible storage.

---

## 6. Ops, Monitoring & Alerting

- Queue depth, retry counts, and processing latencies are published by the document-ingest worker through `@ai-accountant/monitoring-service/services/queueMetrics`.
- Automatic retries exist at every layer (queue DLQs, `bank-feed` retry worker, OCR re-queue, validation reruns). Failures surface in the UI via `ExceptionQueue.tsx` and `QualityDashboard.tsx`.
- Observability dashboards consume metrics from `services/monitoring` plus custom Prometheus exporters inside ingestion/bank-feed workers.
- Golden dataset regression tests (`__tests__/golden-dataset`) ensure extracted data doesn’t drift from curated fixtures; they are part of CI.

**File name:** `PHASE2_FULL_IMPLEMENTATION.md`
