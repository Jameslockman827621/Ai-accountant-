#!/bin/bash

# E2E Test Runner for World-Class Workflows
# This script runs all E2E tests for the new world-class features

set -e

echo "🧪 Running E2E Tests for World-Class Features..."

# Check if database is running
if ! pg_isready -h localhost -p 5432 > /dev/null 2>&1; then
  echo "❌ PostgreSQL is not running. Please start the database first."
  exit 1
fi

# Run database migrations
echo "📦 Running database migrations..."
cd /workspace
if [ -f "services/database/src/migrations/add_world_class_tables.sql" ]; then
  psql -h localhost -U postgres -d ai_accountant -f services/database/src/migrations/add_world_class_tables.sql || echo "⚠️  Migration may have already been run"
fi

# Run E2E tests
echo "🚀 Running E2E tests..."
npm test -- __tests__/e2e/worldClassWorkflows.test.ts __tests__/e2e/integration.test.ts

echo "✅ E2E tests completed!"
