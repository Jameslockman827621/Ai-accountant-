# Plan: World-Class Document Digestion

Chunks cover ingestion channels, OCR, classification, and human-in-loop tooling with clear backend/frontend specs.

---

## Chunk 1 — Omnichannel Intake & Routing

**Goal**  
Accept documents via email forwarding, webhook inboxes, mobile capture, CSV drops, and bulk API, tagging each source for downstream SLAs.

**Backend Spec**
- Extend document-ingest service with:
  - `/api/documents/email/inbound` endpoint (inbound webhook) validating DKIM signatures and mapping to tenant inbox addresses.
  - `/api/documents/webhooks/:source` generic handler that writes payloads to `ingestion_log` with metadata.
  - `email_aliases` table linking tenant + random slug + secret; background job to expire unused aliases.
  - CSV dropzone processor that pulls files from S3 path and enqueues OCR/classification jobs.
- Add ingestion rules engine to auto-route by source (e.g., `source=bank_statement` -> classification bypass).

**Frontend Spec**
- Add `IngestionDashboard` section showing available channels, alias addresses, webhook secrets, and API keys with copy-to-clipboard controls.
- Create setup wizard for email forwarding and webhook subscription with step-by-step instructions.
- Provide CSV drag-and-drop UI that uploads to S3 via signed URL, displays parsing status, and links to review queue.

**Acceptance Criteria**
- Tenants can enable at least three channels (email, webhook, CSV) and see per-channel throughput metrics.
- All intake paths land documents in `documents` table with source metadata populated.

---

## Chunk 2 — Multilingual, Layout-Aware OCR Pipeline

**Goal**  
Replace basic Tesseract worker with GPU-enabled, multilingual, layout-preserving extraction service.

**Backend Spec**
- Introduce `ocr-orchestrator` worker:
  - Uses Google Document AI or AWS Textract for PDFs, PaddleOCR for handwriting, and fallback to Tesseract for offline mode.
  - Supports languages specified per tenant; add `preferred_languages` field.
  - Stores structured output (tokens, bounding boxes) in `document_extractions` table.
- Implement job dispatcher selecting best model per document type & language and handling retries/backoff.
- Add cost tracking per OCR job (token usage, API spend) recorded in `ocr_usage_metrics`.

**Frontend Spec**
- Update document detail view to show rendered extraction overlay (canvas) with selectable text and confidence heatmap.
- Expose language preferences in tenant settings with toggles per service.
- Provide activity feed summarizing OCR jobs with status (pending, running, succeeded, failed) and ability to retry.

**Acceptance Criteria**
- OCR handles English, French, Spanish, German at MVP; adding new language only requires config update.
- Extraction overlay accurately mirrors document layout with <1% positioning error on golden dataset.

---

## Chunk 3 — Deep Classification & Line-Item Extraction

**Goal**  
Achieve high-confidence classification across invoices, receipts, statements, payroll, tax forms, shipping docs, with structured line items and anomaly detection.

**Backend Spec**
- Build transformer-based classifier (e.g., LayoutLMv3 fine-tuned) served via `services/classification`.
- Expand schema: `document_line_items`, `document_entities`, `extraction_confidence`.
- Implement validation DSL rules (required fields per doc type, acceptable ranges) with auto-correct suggestions.
- Add similarity-based duplicate detection and fuzzy vendor matching.
- Introduce golden dataset runner; store fixtures under `__tests__/golden-dataset`.

**Frontend Spec**
- Enhance `DocumentReviewPanel` to show side-by-side original + extracted table, highlight low-confidence fields, and allow inline edits with auto-save.
- Add bulk approval queue with keyboard shortcuts and filters (doc type, confidence, flagged).
- Surface duplicate detection warnings with ability to merge or archive duplicates.

**Acceptance Criteria**
- Classification precision/recall ≥ 0.95 on golden dataset for top doc types; metrics logged nightly.
- Reviewers can correct fields inline; corrections feed active learning queue.

---

## Chunk 4 — Human-in-Loop & Guidance

**Goal**  
Ensure every document has transparent auditability, retry flows, and coaching for better uploads.

**Backend Spec**
- Expand `document_review` service with assignment logic, SLA tracking, and escalation webhooks.
- Store guidance recipes (e.g., “photo too blurry”) and attach to document records.
- Provide `/api/documents/:id/retry` endpoint that restarts pipeline at appropriate stage.

**Frontend Spec**
- Build `QualityChecker` component showing checklist results, suggested actions, and upload tips.
- Introduce reviewer workspace with task list, keyboard navigation, and comment threads per document.
- Add retry button with stage selection (OCR, classification, ledger posting).

**Acceptance Criteria**
- Review queue shows SLA timers; overdue items trigger notifications.
- Users receive actionable guidance after failed upload and can relaunch processing without re-uploading.
