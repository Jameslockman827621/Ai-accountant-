# Phase 2 – Data Gravity

Turn the platform into a continuous data ingestion and classification engine so the AI accountant always has complete, normalized, reconciled information without human uploads.

---

## Mission & Definition of Done
- Achieve automatic, resilient ingestion from banks, payroll, commerce, email, and webhook sources covering at least 95% of customer financial data.
- Classify, normalize, and enrich every incoming document/transaction with confidence scoring and exception routing.
- Provide daily action queues, reconciliation status, and notification workflows that keep users informed without manual spreadsheet work.

**Exit Criteria**
1. ≥ 90% of tenant transactions enter the system via automated connectors (bank feeds, payroll, commerce, email).
2. Classification service produces structured records with ≥ 98% precision/recall on golden dataset; low-confidence items routed to review queue within 5 minutes.
3. Reconciliation automatically matches ≥ 85% of bank transactions to documents within 24 hours.
4. Notification service delivers daily digest + critical alerts with acknowledged receipts logged.

---

## Capability Stack

### Ingestion Pipelines
- **Bank Feeds**: Plaid (US/CA), TrueLayer (UK/EU), SaltEdge fallback. Must support multi-account linking, OAuth refresh, webhook-driven updates, historical sync.
- **Payroll Integrations**: Gusto, QuickBooks Payroll, ADP (read access) with support for gross-to-net, payroll liabilities, remittances.
- **Commerce Integrations**: Shopify, Stripe, Amazon SP-API, PayPal for order and payout data.
- **Email/Webhooks**: Auto-forwarding inbox + webhook collector that parses invoices, receipts, statements; includes deduplication heuristics and S3 archival.
- **CSV Dropzones**: Secure SFTP/portal for bulk imports with schema detection and mapping wizard.

### Classification & Enrichment
- Complete `classification-service`: document type detection, entity extraction, tax fields, line-item parsing, currency normalization.
- Confidence scoring per field; include model version, feature flags, and fallback to deterministic regex templates when AI uncertain.
- Vendor enrichment (VAT registration lookup, W-9/W-8 matching, CRA BN verification).
- Auto-tagging for recurring vendors/customers, gl-code suggestions, and compliance flags (e.g., missing VAT number).

### Reconciliation & Notifications
- New `reconciliation-service`: matching engine combining bank, invoices, receipts, payouts; support tolerance rules, multi-currency, partial matches.
- `notification-service`: templating, scheduling, channels (email, SMS, in-app, push), preference center, SLA tracking.
- Daily “Command Center” dashboard summarizing inbox, reconciliations, anomalies, connector health, and outstanding tasks.

### Data & Storage
- **Unified Ingestion Log** capturing source, connector version, payload hashes, processing latency, retry counts.
- **Feature store** for classification models (e.g., vendor embeddings, pattern fingerprints).
- **Exception queues** in RabbitMQ/SQS with visibility timeouts, manual claim, and audit notes.

### AI/ML
- Train transformer-based classifier fine-tuned on internal corpus; maintain evaluation harness per document type and jurisdiction.
- Implement active learning loop: human corrections captured in review UI automatically feed labeling pipeline.
- Introduce anomaly detectors (e.g., transaction amount deviation, duplicate invoices, suspicious vendors).

### Security & Compliance
- Secrets rotation + OAuth token storage via Vault/KMS; monitor for unauthorized connector access.
- PII redaction pipeline for logs; configurable retention per jurisdiction.
- Data residency controls (UK data in-region when required).

### Observability
- Metrics per connector: success rate, freshness, throughput, latency, error buckets.
- Distributed tracing across ingestion → classification → ledger pipeline.
- Alerting on connector downtime, classification backlog, reconciliation failure spikes.

---

## Deliverables Checklist
1. Connector SDKs with sandbox + prod configs, retry logic, and health endpoints.
2. Classification service GA release with REST + message consumer interfaces.
3. Reconciliation microservice (API + event subscriptions) and UX surfaces (matching UI, exception queue, audit trail).
4. Notification service with scheduler, template manager, localization, and multi-channel delivery.
5. Command Center dashboard in web app plus mobile notifications.
6. Golden dataset for classification + reconciliation, stored in `/__tests__/golden-dataset`.
7. Runbooks for connector outages, classification drift, notification failures.

---

## Work Packages & Sequencing
1. **Pipelines Foundation (Week 1-2)**  
   - Build unified ingestion log, connector registry extensions, webhook listeners, queue topology.  
   - Define contract for classification outputs and reconciliation inputs.
2. **Connector Rollout (Week 2-5)**  
   - Ship Plaid + TrueLayer connectors with sync scheduler.  
   - Add payroll + commerce connectors; include credential management UI and health badges.  
   - Implement email/webhook ingestion pipeline with spam filtering and dedupe.
3. **Classification Engine (Week 3-6)**  
   - Finalize service architecture, deploy models (base + deterministic fallback), integrate with ingestion events.  
   - Build human review UI, correction logging, and feedback loop.
4. **Reconciliation & Notifications (Week 4-7)**  
   - Deliver matching engine, reconciliation UI, write-back to ledger, audit logging.  
   - Stand up notification service, templates, preference center, digest generator.
5. **Command Center & QA (Week 6-8)**  
   - Dashboard surfaces, anomaly widgets, connector health timeline.  
   - Load tests, chaos tests (connector outages), classification accuracy validation, SOC controls review.

---

## Success Metrics
- Connector freshness: > 99% of feeds updated within SLA (bank < 4h, payroll < 24h, commerce < 1h).
- Classification F1 ≥ 0.98 on golden dataset; manual intervention rate < 5%.
- Reconciliation automation rate ≥ 85%; unresolved exceptions resolved within 2 business days.
- Notification open rate ≥ 60%, unsubscribe rate < 2%.

---

## Risks & Mitigation
- **API rate limits/outages** → Adaptive polling, exponential backoff, multi-provider redundancy, cached payloads.
- **Data quality variance** → Schema detection, validation rules, user-defined mappings, versioned parsers.
- **Notification fatigue** → Preference center with granular controls, digest bundling, AI-prioritized severity.
- **Privacy concerns for email ingestion** → Dedicated inbox per tenant, auto redaction of non-financial content, configurable filters.

---

## Dependencies & Handoffs
- Requires Phase 1 intent profile to know required connectors and filing cadences.
- Coordination with security for vaulted secrets and connector scope approvals.
- ML team for model training + evaluation harness.
- Frontend/mobile for Command Center, notification settings, review UI.

This document should be used by AI agents and engineers to implement the entire Data Gravity phase end-to-end.
