# Payroll Integrations (QuickBooks & ADP) – Implementation Plan

## Overview
- Extend existing payroll integration surface so accountants can connect QuickBooks Payroll and ADP Workforce Now, sync payroll runs, and push journal entries into the ledger.
- Current UI buttons in `apps/web/src/components/PayrollIntegration.tsx` simply alert “coming soon”, and backend endpoints (`services/payroll/src/routes/payroll.ts`) only implement the Gusto OAuth path and return empty runs.

## Frontend Scope
1. **Connector cards**
   - Update provider definitions to include:
     - OAuth status badges (Connected / Needs attention / Error).
     - Realm ID / company ID labels for QuickBooks + ADP, derived from backend metadata.
   - Display next scheduled sync and last sync result for every connector.
2. **QuickBooks OAuth**
   - Implement `connectQuickBooks()` to call new `GET /api/payroll/quickbooks/authorize` endpoint, redirect to Intuit OAuth, and handle redirect (similar to Gusto flow). Store returned `state` in `localStorage` for CSRF verification.
   - Add redirect handler page (`/payroll/quickbooks/callback`) to exchange code by calling `POST /api/payroll/quickbooks/connect` (provide `code`, `realmId`, `state`).
3. **ADP OAuth**
   - Same pattern: `GET /api/payroll/adp/authorize` + callback page posting to `POST /api/payroll/adp/connect`.
   - ADP requires OAuth + certificate; ensure UI surfaces instructions (upload cert? or copy SFTP credentials).
4. **Sync controls**
   - For connected providers, allow manual sync window selection (start/end date) and trigger `POST /api/payroll/sync/:connectorId`.
   - Show toast notifications on success/failure.
5. **Payroll run viewer**
   - Add table component (e.g., `PayrollRunsTable`) in the same page or dedicated route:
     - Columns: Provider, Pay Period, Check Date, Gross Pay, Net Pay, Employer Taxes, Status.
     - Filter by provider/date range (call `GET /api/payroll/runs?provider=quickbooks&startDate=…`).
6. **Testing**
   - Add component/unit tests verifying connectors render correct CTAs per status.
   - Add Playwright flow simulating QuickBooks connect + manual sync, asserting run rows show up.

## Backend Scope
1. **Data model & storage**
   - Ensure `connector_registry` stores provider-specific metadata (QuickBooks: realmId, refresh token expiry; ADP: company code, certificate alias). Encrypted secret storage should leverage `packages/secure-store` or a new secrets table.
   - Create `payroll_runs` table capturing normalized run data (tenant, provider, provider_run_id, pay period, totals, raw payload).
2. **OAuth flows**
   - **QuickBooks**
     - Implement `GET /api/payroll/quickbooks/authorize` returning Intuit URL (use `QuickBooksPayrollService.generateAuthorizationUrl` with state).
     - Implement `POST /api/payroll/quickbooks/connect`:
       - Validate state matches stored nonce.
       - Call `exchangeCodeForToken` to obtain access/refresh tokens.
       - Persist in secure store and `connector_registry`.
   - **ADP**
     - Add `createADPService` helper if missing.
     - Endpoints `GET /api/payroll/adp/authorize` + `POST /api/payroll/adp/connect` to handle OAuth 2.0 client credentials / authorization code depending on ADP flavor.
     - Store tenant-specific credentials + metadata.
3. **Sync pipeline**
   - Expand `POST /sync/:connectorId` to:
     - Fetch connector record & secrets.
     - Call provider APIs (QuickBooks: `/PayrollRun`, ADP: payroll reports).
     - Normalize results into `payroll_runs`.
     - Enqueue ingestion record via `unifiedIngestionService`.
     - Optionally auto-post ledger entries using existing posting service.
   - Add background scheduler (`scheduler/syncScheduler.ts`) to run periodic syncs per connector (`node-cron` or Bull queue).
4. **API for payroll runs**
   - Implement `GET /runs` to query `payroll_runs` with filters (date range, provider) and paging.
   - Add `GET /runs/:id` for detailed view (raw payload + posting references).
5. **Error handling**
   - Surface token expiration; automatically refresh QuickBooks tokens via refresh token workflow and mark connector status when refresh fails.
   - Implement webhook/callback endpoints if providers support push notifications.
6. **Testing**
   - Unit tests for new service classes (mock provider responses).
   - Integration tests using provider sandboxes or mocked HTTP servers (nock).
   - Load test to ensure sync pipeline can handle multiple payroll runs per tenant.

## Infrastructure / DevOps
- Configure provider credentials in environment (`QUICKBOOKS_CLIENT_ID`, `ADP_CLIENT_ID`, etc.) and ensure CI secrets.
- Update documentation for setting redirect URIs (Intuit developer portal, ADP developer account).
- Add monitoring around payroll sync jobs (metrics via monitoring service).

## Risks / Open Questions
- ADP integration complexity (SAML vs OAuth) — confirm required auth flow.
- Need ledger mapping (chart of accounts) per payroll provider; might require UI to map expense/liability accounts before posting.

