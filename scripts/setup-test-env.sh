#!/bin/bash

set -e

echo "Setting up test environment..."

# Create test database
createdb test_ai_accountant || true

# Run migrations
npm run db:migrate

# Seed test data
npm run db:seed

# Set up test fixtures
echo "Test environment setup complete"
