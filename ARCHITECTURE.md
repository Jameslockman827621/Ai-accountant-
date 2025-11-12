# Architecture Overview

## System Architecture

The AI Accountant SaaS is built as a microservices architecture with the following components:

### Core Services

1. **API Gateway** (Port 3000)
   - Routes requests to appropriate services
   - Handles authentication and rate limiting
   - Single entry point for all API calls

2. **Authentication Service** (Port 3001)
   - User registration and login
   - JWT token generation and validation
   - Multi-tenant user management
   - Role-based access control

3. **Document Ingest Service** (Port 3002)
   - File upload handling
   - Document storage (S3/MinIO)
   - Triggers OCR processing
   - Email and webhook ingestion

4. **OCR Service** (Worker)
   - Text extraction from images and PDFs
   - Document preprocessing
   - Tesseract.js integration
   - Processes jobs from message queue

5. **Ledger Service** (Port 3003)
   - Double-entry accounting
   - Chart of accounts management
   - Transaction posting
   - Account balance calculations
   - Reconciliation

6. **Rules Engine Service** (Port 3004)
   - Tax rule evaluation
   - Jurisdictional rulepacks
   - Deterministic and LLM-based rules
   - VAT calculation

7. **Assistant Service** (Port 3005)
   - RAG-based conversational AI
   - Vector database integration (Chroma)
   - LLM query processing
   - Citation and source tracking

8. **Billing Service** (Port 3006)
   - Subscription management
   - Usage tracking
   - Tier management

### Data Storage

- **PostgreSQL**: Primary database for all transactional data
- **S3/MinIO**: Object storage for documents
- **Chroma**: Vector database for RAG retrieval
- **Redis**: Caching (optional)
- **RabbitMQ**: Message queue for async processing

### Frontend

- **Next.js Web App**: React-based dashboard
  - Document upload
  - Ledger viewing
  - AI Assistant chat
  - Dashboard and reports

## Data Flow

1. **Document Processing:**
   - User uploads document → Document Ingest Service
   - Document stored in S3 → OCR job queued
   - OCR Service processes → Extracted text stored
   - Classification Service → Document type identified
   - Rules Engine → Tax calculation
   - Ledger Service → Transaction posted

2. **AI Assistant Query:**
   - User asks question → Assistant Service
   - RAG retrieval → Relevant context from vector DB
   - LLM processing → Answer generated with citations
   - Response returned to user

3. **Tax Filing:**
   - Rules Engine calculates tax → Filing Service
   - Filing generated → User approval
   - Submitted to HMRC API → Confirmation stored

## Security

- **Authentication**: JWT tokens with expiration
- **Authorization**: Role-based access control (RBAC)
- **Tenant Isolation**: Row-level security in database
- **Encryption**: TLS in transit, AES-256 at rest
- **Audit Logging**: All actions logged immutably

## Scalability

- **Horizontal Scaling**: All services are stateless
- **Load Balancing**: API Gateway distributes load
- **Async Processing**: Message queue for heavy tasks
- **Caching**: Redis for frequently accessed data
- **Database**: Read replicas for scaling reads

## Monitoring

- **Health Checks**: All services expose `/health`
- **Metrics**: Prometheus for service metrics
- **Logging**: Structured JSON logs
- **Tracing**: Distributed tracing (when configured)
- **Alerting**: Grafana alerts for SLO violations

## Deployment

- **Development**: Docker Compose for local setup
- **Production**: Kubernetes for orchestration
- **CI/CD**: GitHub Actions for automated deployment
- **Canary**: Gradual rollout strategy
