# AI Accountant SaaS

Complete autonomous accounting system powered by AI that performs bookkeeping, tax filings, compliance monitoring, and acts as a conversational financial assistant.

## 🚀 Quick Start

```bash
# Clone the repository
git clone <repository-url>
cd ai-accountant-saas

# Run setup script
./scripts/setup.sh

# Or manually:
npm install
docker-compose up -d
npm run db:migrate
npm run db:seed

# Start development
npm run dev
```

Visit http://localhost:3000 and login with:
- Email: `admin@example.com`
- Password: `admin123`

## 📋 Prerequisites

- **Node.js** 18+ 
- **Docker** and Docker Compose
- **PostgreSQL** 14+ (or use Docker)
- **OpenAI API Key** (for AI features)

## 🏗️ Architecture

This is a monorepo containing:
- **packages/**: Shared libraries and utilities
  - `shared-types`: TypeScript type definitions
  - `shared-utils`: Common utilities (JWT, encryption, validation, logging)
- **services/**: Microservices
  - `api-gateway`: API routing and gateway
  - `auth-service`: Authentication and authorization
  - `document-ingest-service`: Document upload and storage
  - `ocr-service`: Text extraction from documents
  - `ledger-service`: Double-entry accounting
  - `rules-engine-service`: Tax rules and calculations
  - `assistant-service`: AI conversational interface
  - `billing-service`: Subscriptions and usage
- **apps/**: Frontend applications
  - `web`: Next.js web application

## 🛠️ Tech Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript (strict mode)
- **Database**: PostgreSQL 14+
- **Message Queue**: RabbitMQ
- **Storage**: S3-compatible (MinIO for local)
- **Vector DB**: Chroma (for RAG)
- **Frontend**: Next.js 14, React 18, Tailwind CSS
- **AI/ML**: OpenAI GPT-4, Tesseract.js (OCR)
- **Containerization**: Docker, Docker Compose
- **CI/CD**: GitHub Actions

## 📦 Services

| Service | Port | Description |
|---------|------|-------------|
| API Gateway | 3000 | Request routing and authentication |
| Auth Service | 3001 | User authentication, JWT, roles |
| Document Ingest | 3002 | File uploads and storage |
| Ledger Service | 3003 | Double-entry accounting |
| Rules Engine | 3004 | Tax rules and calculations |
| Assistant Service | 3005 | AI conversational interface |
| Billing Service | 3006 | Subscriptions and usage |
| OCR Service | Worker | Text extraction from documents |

## 🚦 Development

### Start All Services

```bash
npm run dev
```

### Individual Services

```bash
# Auth service
cd services/auth && npm run dev

# Document service
cd services/document-ingest && npm run dev

# Frontend
cd apps/web && npm run dev
```

### Database

```bash
# Run migrations
npm run db:migrate

# Seed data
npm run db:seed

# Reset database (WARNING: deletes all data)
docker-compose down -v
docker-compose up -d postgres
npm run db:migrate
npm run db:seed
```

### Testing

```bash
# Run all tests
npm test

# Run tests for specific service
cd services/auth && npm test

# Type checking
npm run type-check

# Linting
npm run lint
```

## 🔧 Configuration

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Configure environment variables:
   - `JWT_SECRET`: Strong secret for JWT signing
   - `OPENAI_API_KEY`: Your OpenAI API key
   - `DB_*`: Database connection details
   - `S3_*`: Object storage configuration

## 📚 Documentation

- [Architecture Overview](./ARCHITECTURE.md)
- [Deployment Guide](./DEPLOYMENT.md)
- [Project Status](./PROJECT_STATUS.md)
- [Roadmap](./AI_ACCOUNTANT_SAAS_ROADMAP.md)

## 🧪 Testing

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test file
npm test -- services/auth/src/__tests__/auth.test.ts
```

## 🐳 Docker

```bash
# Start all infrastructure
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down

# Rebuild containers
docker-compose up -d --build
```

## 🔐 Security

- JWT-based authentication
- Role-based access control (RBAC)
- Multi-tenant data isolation
- Row-level security in database
- Encryption utilities (AES-256)
- Rate limiting on API Gateway

## 📊 Project Status

See [PROJECT_STATUS.md](./PROJECT_STATUS.md) for detailed status of all components.

**Completed:**
- ✅ Core microservices architecture
- ✅ Authentication and authorization
- ✅ Document processing pipeline
- ✅ OCR and text extraction
- ✅ Double-entry accounting ledger
- ✅ Tax rules engine
- ✅ AI Assistant with RAG
- ✅ Frontend dashboard
- ✅ Database schema and migrations

**In Progress:**
- 🚧 Comprehensive test coverage
- 🚧 HMRC filing integration
- 🚧 Bank feed integration
- 🚧 Monitoring and observability

## 🤝 Contributing

1. Create a feature branch
2. Make your changes
3. Run tests and linting
4. Submit a pull request

## 📝 License

Proprietary - All rights reserved

## 🆘 Support

For issues and questions:
1. Check the [Documentation](./ARCHITECTURE.md)
2. Review [Project Status](./PROJECT_STATUS.md)
3. Open an issue on GitHub

## 🎯 Roadmap

See [AI_ACCOUNTANT_SAAS_ROADMAP.md](./AI_ACCOUNTANT_SAAS_ROADMAP.md) for the complete product roadmap.

**Phase 1 (MVP)**: ✅ Complete
- Document upload and processing
- OCR and extraction
- Ledger posting
- Basic AI assistant

**Phase 2**: 🚧 In Progress
- Tax filing integration
- Bank feed integration
- Accountant portal
- Advanced reporting

**Phase 3**: 📋 Planned
- Multi-country support
- Payroll automation
- Forecasting and predictions
- Mobile app
