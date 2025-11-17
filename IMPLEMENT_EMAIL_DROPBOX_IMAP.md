# Email Dropbox IMAP Ingestion – Implementation Plan

## Overview
- Enable the email dropbox feature to ingest receipts/invoices directly from tenant mailboxes via IMAP.
- Today `EmailDropboxService.startImapListener` and `openInbox` merely log TODOs, so no emails ever get processed.

## Backend Scope (services/ingestion)
1. **Dependencies & configuration**
   - Add IMAP + mail parsing libs to `services/ingestion` (e.g., `imapflow` or `node-imap`, `mailparser`).
   - Configurable env vars (global + per-tenant):
     - Default polling interval / concurrency.
     - TLS cert validation toggle for testing.
2. **Connection lifecycle**
   - Replace placeholder `imapConnections` entries with actual clients:
     - Manage connection pool keyed by `tenantId:emailAddress`.
     - Handle reconnect with exponential backoff on failures.
     - Expose `startImapListener` + `stopImapListener` + `restartImapListener` methods for admin actions.
3. **Mailbox monitoring**
   - For each active dropbox, open the configured mailbox (default `INBOX`).
   - Use IDLE/push notifications when available; otherwise poll via `search(['UNSEEN'])`.
   - Upon new message:
     - Fetch envelope + body structure.
     - Stream attachments through `mailparser`.
     - Call existing `processEmail` → `processAttachment`.
4. **Deduplication**
   - Enhance `createEmailHash` to include `messageId`, `Date`, `checksum` of attachments.
   - Record processed UID to avoid reprocessing when connection restarts.
5. **Error handling**
   - If attachment exceeds size limit or type not supported, log and mark ingestion event as failed (`status = 'error'`, reason).
   - Automatically deactivate dropbox after repeated authentication failures; surface via API.
6. **API enhancements**
   - Extend dropbox routes (if present) to:
     - Display connection status/last sync/time of last email.
     - Provide manual “Resync” endpoint to re-read a date range.
7. **Observability**
   - Emit metrics (`ingestion-email.messages_processed`, `attachments_processed`, `errors`) via monitoring middleware.
   - Add structured logs with tenant + mailbox for troubleshooting.
8. **Security**
   - Encrypt IMAP credentials at rest using `packages/secure-store` (never store plain passwords).
   - Support OAuth2 tokens for providers that require it (Gmail, Outlook) by abstracting auth.
9. **Testing**
   - Write unit tests for `processEmail` covering dedupe logic + metadata extraction.
   - Integration test using a local IMAP server (e.g., `greenmail`) as part of CI, ensuring attachments become document records and OCR flow is triggered.

## Frontend Scope
- Admin UI (if/when dropbox config UI exists) should expose connection health, last sync, and error messages.
- If no UI currently, create a small settings panel under onboarding/connectivity or support center to:
  - Display configured dropboxes.
  - Trigger manual restart/resync via new backend endpoints.
  - Surface alerts when ingestion fails repeatedly (tie into notification service).

## Infrastructure / DevOps
- Provide optional local IMAP container for dev/testing (e.g., add to `docker-compose.yml`).
- Ensure secrets management pipeline can store IMAP credentials per tenant (HashiCorp Vault, AWS Secrets Manager).
- Document steps for enabling OAuth with Gmail/Outlook (redirect URIs, scopes).

## Risks / Open Questions
- Multi-tenant scaling: hundreds of IMAP connections might be expensive — consider worker pool approach or serverless fetch via webhook integration.
- Need retention policy for raw messages? Currently only attachments logged; confirm compliance requirements.

