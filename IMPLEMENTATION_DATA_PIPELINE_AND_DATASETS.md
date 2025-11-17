# Implementation Playbook – Data Ingestion & Golden Datasets

## Objective
Stand up always-on ingestion, bank connectivity, and labeled datasets so extraction, reconciliation, and tax models have trustworthy, audit-ready data across the full document → ledger → filing lifecycle.

## Scope
- Channels: dashboard uploads, mobile capture, email forwarding, webhook mirroring, CSV drop zones, and automated bank feeds (Plaid, TrueLayer, manual CSV).
- Data assets: raw files, parsed text, structured fields, ledger posts, reconciliation ground truth, filing outcomes.
- Golden dataset factory with labeling tooling, QA workflows, and automated refresh cadence.

## Backend Workstreams
### 1. Email/Webhook/Mobile Intake
- **Services**: extend `services/ingestion` & `services/document-ingest` to accept signed webhook payloads (Shopify, Stripe, marketplaces) and IMAP/SES email dropboxes.
- **Pipelines**: normalize payloads into a common `ingestion_events` table (tenant, channel, checksum, SLA timestamps) and publish to OCR/classification queues.
- **Security**: enforce HMAC verification, rate limiting, per-tenant API keys, and attach trace IDs for observability.

### 2. Bank Feed Coverage & Health
- **Connectors**: expand `services/bank-feed` to support additional providers (GoCardless Bank Account Data, Nordigen), plus manual CSV ingestion with schema validation.
- **Scheduler**: upgrade `syncScheduler` to prioritize stale connections, run differential fetches, and emit Prometheus metrics (`bank_sync_latency_seconds`).
- **Recovery**: auto-refresh tokens, surface connection degradation to the frontend health card, and log retries in `bank_sync_audit`.

### 3. Data Lake & Warehousing
- **Storage**: mirror raw documents to a versioned bucket (`s3://tenant-id/raw/<ingest-id>/v1`) and push structured outputs to a columnar warehouse (BigQuery/ClickHouse) via nightly jobs.
- **Contracts**: define Avro/JSON schemas for `document_extractions`, `ledger_events`, `filing_snapshots` with backward-compatible migrations.
- **Access**: expose warehouse read replicas to analytics service via service accounts and row-level filters per tenant.

### 4. Golden Dataset Factory
- **Labeling UI**: extend reviewers’ dashboard to allow field-by-field validation, tagging of anomalies, and expected ledger postings; persist decisions in `golden_labels`.
- **Sampling**: cron job selects stratified samples (by vendor, category, confidence) and enqueues labeling tasks; ensure coverage targets (≥30 samples per category monthly).
- **Versioning**: snapshot datasets (Delta Lake/Parquet) with semantic versions (`dataset-vYYYY.MM.patch`), track provenance, and expose to ML pipelines.

## Frontend Workstreams
### Document Intake UX
- Drag-and-drop multi-upload with progress bars, retry, and channel selector (dashboard/mobile/email alias info).
- Inline guidance cards showing supported formats, SLA expectations, and privacy assurances.

### Data QA Consoles
- Golden dataset reviewer workbench: split view (document preview, extracted fields, ledger suggestions) with keyboard shortcuts and confidence heatmaps.
- Connection health page highlighting bank feeds/webhooks with last sync time, failures, and re-auth CTAs.

## Infrastructure & Ops
- Provision IMAP/SES ingress, secure webhooks via API Gateway custom domains, and configure mobile capture SDK for offline uploads.
- Set up warehouse ETL (Airbyte/Dagster) with monitoring, retries, and data-quality checks (Great Expectations).
- Define retention & encryption policies: raw documents encrypted at rest (KMS), golden datasets hashed, warehouse access audited.

## Metrics & Acceptance
- ≥95% of documents ingested via automated channels (not manual upload) within 60 days.
- Golden dataset contains ≥10k labeled samples spanning top 20 vendors/categories with drift alerts.
- Bank feed freshness: 99% of active connections synced in last 24h; alert if SLA breached.

## Dependencies & Sequencing
1. Stand up secure webhook/email infrastructure.
2. Expand bank connectors & health telemetry.
3. Build labeling UI + dataset storage.
4. Wire ETL to warehouse and publish dataset catalog.
5. Roll out UX improvements and train reviewers.
