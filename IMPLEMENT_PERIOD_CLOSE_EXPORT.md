# Period Close Package Export – Implementation Plan

## Overview
- Deliver downloadable period-close packages (zip/PDF) from the ledger service.
- Currently `GET /api/ledger/period-close/:id/export` simply returns `{ location }` with a TODO.
- Need end-to-end path: close package generation, storage, signed URL retrieval, and UI download.

## Frontend Scope
1. **UI wiring**
   - In whichever component surfaces period close status (e.g., `ReconciliationDashboard` or dedicated period-close page), add a “Download Close Package” button.
   - Fetch `GET /api/ledger/period-close/:id/export` and:
     - If response contains `downloadUrl`, trigger file download (new window or programmatic link).
     - Handle cases where package is unavailable (disable button, show tooltip).
2. **Progress indicators**
   - Show spinner while backend prepares package (if asynchronous). For large packages, poll `GET /period-close/:id` until `exportPackageStatus === 'ready'`.
3. **Error handling**
   - Display toast/snackbar when download fails (HTTP errors or expired link). Offer “Regenerate package” action if backend exposes it.
4. **Testing**
   - Component tests confirming button disabled until status ready.
   - E2E test verifying clicking download triggers real file download (mocked response) and that error states render.

## Backend Scope (services/ledger)
1. **Storage design**
   - When period close completes, generate archive (zip of ledger summaries, journal entries, validations, attachments). Store in object storage (MinIO/S3).
   - Save metadata to `period_close_runs` table:
     - `export_package_location`, `content_type`, `content_length`, `checksum`, `status`, `expires_at`.
2. **Export endpoint**
   - Update `GET /period-close/:id/export` to:
     - Verify tenant access and close status.
     - If package missing or stale, optionally trigger regeneration (async job) and return `202 Accepted`.
     - If available, generate a **signed URL** (S3 presigned GET) with configurable TTL (e.g., 5 minutes) and return `{ downloadUrl, expiresAt }`.
3. **Package generation**
   - Introduce worker (Bull queue / cron) that:
     - Pulls ledger data, reconciliations, validation reports.
     - Renders summary (PDF/CSV) and bundles into archive.
     - Uploads to S3/MinIO via `@aws-sdk/client-s3` or existing storage abstraction.
     - Updates DB status (`ready`, `failed`) + metadata.
4. **Regeneration endpoint**
   - Optional `POST /period-close/:id/export/regenerate` to force rebuild (audited).
5. **Security & auditing**
   - Signed URLs should be short-lived; log every issuance (user, tenant, closeId).
   - Ensure packages contain only tenant data; double-check query scoping.
6. **Testing**
   - Unit tests for service that builds signed URLs (mock S3).
   - Integration test: run sample close, invoke export, assert HTTP 200 with URL, and that GET to signed URL returns archive.
   - Performance test for large periods to size package generation time.

## Infrastructure / DevOps
- Ensure MinIO/S3 bucket has lifecycle policy to expire close packages after retention (e.g., 90 days).
- If using AWS S3, provide IAM role/keys with `GetObject` + `PutObject`.
- Update CI to run package-generation tests (may need mocking).
- Document environment variables (`PERIOD_CLOSE_ARCHIVE_BUCKET`, `EXPORT_URL_TTL_SECONDS`).

## Risks / Open Questions
- Package size could be large; may need streaming download to avoid memory spikes.
- Regeneration may overlap with existing package; need locking / status transitions.
- Confirm compliance requirements for storing exported archives (encryption at rest, retention).

