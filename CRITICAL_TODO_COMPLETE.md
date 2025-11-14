# Critical TODO - Complete Implementation

## 🔴 CRITICAL - Core Business Logic

### 1. Double-Entry Ledger Posting
- [ ] Implement proper double-entry validation (debits = credits)
- [ ] Add transaction grouping (single transaction = multiple entries)
- [ ] Add account balance calculation
- [ ] Add reconcileEntries function
- [ ] Add getAccountBalance function

### 2. Document to Ledger Pipeline
- [ ] Create document posting service
- [ ] Connect classification → extraction → posting
- [ ] Auto-create ledger entries from documents
- [ ] Handle tax calculation in posting

### 3. Chart of Accounts
- [ ] Create default UK chart of accounts
- [ ] Add account validation
- [ ] Add account setup endpoint
- [ ] Validate account codes exist before posting

### 4. Automation Actions
- [ ] Implement categorize action
- [ ] Implement post_ledger action
- [ ] Implement send_notification action
- [ ] Implement create_task action
- [ ] Create ruleEngine service

### 5. Missing Service Functions
- [ ] Complete notification service functions
- [ ] Complete compliance getAuditLogs
- [ ] Complete reconciliation reconcileEntries
- [ ] Complete reconciliation getAccountBalance

### 6. Database Migrations
- [ ] Create proper migration system with versioning
- [ ] Run all migration files
- [ ] Add migration tracking table

### 7. Field Extraction
- [ ] Create structured field extraction service
- [ ] Use LLM for field extraction
- [ ] Validate extracted fields

### 8. Integration Completeness
- [ ] Add Stripe webhook signature verification
- [ ] Add Xero token refresh
- [ ] Add QuickBooks token refresh
- [ ] Add Plaid token refresh

### 9. Error Handling
- [ ] Add circuit breakers to external APIs
- [ ] Add retry logic consistently
- [ ] Add dead letter queues

### 10. Health Checks
- [ ] Add dependency health checks
- [ ] Add database health
- [ ] Add Redis health
- [ ] Add RabbitMQ health
