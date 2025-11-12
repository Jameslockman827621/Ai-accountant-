# Critical Gaps - Complete Implementation TODO

## 🔴 CRITICAL - Core Business Logic

### 1. Double-Entry Ledger Posting
- [ ] Implement proper double-entry validation (debits must equal credits)
- [ ] Add transaction grouping (single transaction = multiple entries)
- [ ] Add balance validation
- [ ] Add account validation against chart of accounts

### 2. Document to Ledger Pipeline
- [ ] Create document posting service
- [ ] Auto-post documents after classification
- [ ] Apply tax rules during posting
- [ ] Create matching debit/credit entries

### 3. Chart of Accounts
- [ ] Create default UK chart of accounts
- [ ] Add account validation
- [ ] Add account setup during onboarding

### 4. Missing Service Functions
- [ ] Implement `reconcileEntries` and `getAccountBalance` in ledger service
- [ ] Implement `getAuditLogs` in compliance service
- [ ] Implement `ruleEngine` in automation service
- [ ] Complete automation action implementations

### 5. Database Migrations
- [ ] Update migration system to run new migration files
- [ ] Add migration for all new tables
- [ ] Add seed data

### 6. Integration Completeness
- [ ] Complete Stripe webhook signature verification
- [ ] Complete Xero token refresh
- [ ] Complete QuickBooks token refresh
- [ ] Add OAuth flows for Xero/QuickBooks

### 7. Field Extraction
- [ ] Implement structured field extraction from documents
- [ ] Add validation of extracted fields
- [ ] Add confidence scoring per field

### 8. RAG Pipeline
- [ ] Complete document indexing after OCR
- [ ] Add document chunking strategy
- [ ] Add embedding generation pipeline

### 9. Health Checks
- [ ] Add dependency health checks (DB, Redis, RabbitMQ, S3)
- [ ] Add service-to-service health checks

### 10. Error Recovery
- [ ] Implement retry logic for failed document processing
- [ ] Add dead letter queue handling
- [ ] Add manual correction workflows
