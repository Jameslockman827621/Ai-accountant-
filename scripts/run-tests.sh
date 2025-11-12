#!/bin/bash

set -e

echo "=== Running Test Suite ==="

# Run unit tests
echo "Running unit tests..."
npm run test -- --testPathPattern=__tests__/unit

# Run integration tests
echo "Running integration tests..."
npm run test -- --testPathPattern=__tests__/integration

# Run E2E tests
echo "Running E2E tests..."
npm run test -- --testPathPattern=__tests__/e2e

# Generate coverage report
echo "Generating coverage report..."
npm run test -- --coverage

echo "=== Test Suite Complete ==="
