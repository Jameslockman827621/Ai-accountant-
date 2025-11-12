# Integration Tests

## Overview

Integration tests verify that multiple services work together correctly. These tests require a running database and may require other infrastructure services.

## Running Integration Tests

```bash
# Start infrastructure
docker-compose up -d

# Run integration tests
npm run test:integration

# Run specific integration test
npm run test:integration -- services/auth/integration/auth-flow.test.ts
```

## Test Structure

### Auth Flow Integration Test
Tests the complete authentication flow:
1. User registration
2. Login
3. Token validation
4. Protected route access

### Document Processing Flow
Tests the complete document processing pipeline:
1. Document upload
2. OCR processing
3. Classification
4. Ledger posting

### Tax Calculation Flow
Tests tax calculation end-to-end:
1. Document upload
2. Data extraction
3. Tax rule application
4. Ledger entry creation

## Test Data

Integration tests use a separate test database to avoid affecting development data.

## Environment Setup

Integration tests require:
- PostgreSQL database
- Redis (optional, for caching)
- RabbitMQ (for message queue tests)
- MinIO/S3 (for document storage tests)

## Continuous Integration

Integration tests run in CI/CD pipeline after unit tests pass.
