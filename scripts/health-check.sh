#!/bin/bash

set -e

echo "Running health checks..."

# Check API Gateway
curl -f http://localhost:3000/health || exit 1

# Check all services
for port in 3001 3002 3003 3004 3005 3006 3010; do
  curl -f http://localhost:$port/health || echo "Service on port $port not healthy"
done

echo "Health checks complete"
