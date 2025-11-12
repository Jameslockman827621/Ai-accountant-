#!/bin/bash

set -e

echo "🚀 Setting up AI Accountant SaaS..."

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 18+ required. Current version: $(node -v)"
  exit 1
fi

echo "✅ Node.js version: $(node -v)"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo "⚠️  Docker is not running. Please start Docker and run this script again."
  exit 1
fi

# Start infrastructure
echo "🐳 Starting infrastructure services..."
docker-compose up -d

# Wait for PostgreSQL
echo "⏳ Waiting for PostgreSQL to be ready..."
sleep 5

# Run migrations
echo "🗄️  Running database migrations..."
cd services/database
npm run migrate || echo "⚠️  Migration failed - database may already be set up"
cd ../..

# Seed database
echo "🌱 Seeding database..."
cd services/database
npm run seed || echo "⚠️  Seeding failed - database may already be seeded"
cd ../..

echo "✅ Setup complete!"
echo ""
echo "📝 Next steps:"
echo "1. Copy .env.example to .env and configure your environment variables"
echo "2. Set your OPENAI_API_KEY in .env for AI features"
echo "3. Run 'npm run dev' to start all services"
echo ""
echo "🌐 Services will be available at:"
echo "  - API Gateway: http://localhost:3000"
echo "  - Web App: http://localhost:3000 (when frontend is running)"
echo "  - Auth Service: http://localhost:3001"
echo "  - Document Service: http://localhost:3002"
echo "  - Ledger Service: http://localhost:3003"
echo "  - Rules Service: http://localhost:3004"
echo "  - Assistant Service: http://localhost:3005"
echo ""
echo "🔐 Default credentials (from seed):"
echo "  Email: admin@example.com"
echo "  Password: admin123"
