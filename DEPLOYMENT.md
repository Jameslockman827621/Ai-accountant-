# Deployment Guide

## Prerequisites

- Node.js 18+
- Docker and Docker Compose
- PostgreSQL 14+
- Redis (optional, for caching)
- RabbitMQ (for message queue)
- MinIO or S3-compatible storage

## Local Development Setup

1. **Clone and install dependencies:**
   ```bash
   npm install
   ```

2. **Start infrastructure services:**
   ```bash
   docker-compose up -d
   ```

3. **Set up database:**
   ```bash
   npm run db:migrate
   npm run db:seed
   ```

4. **Configure environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

5. **Start all services:**
   ```bash
   npm run dev
   ```

## Production Deployment

### Using Docker

1. **Build Docker image:**
   ```bash
   docker build -t ai-accountant-saas .
   ```

2. **Run with docker-compose:**
   ```bash
   docker-compose -f docker-compose.prod.yml up -d
   ```

### Using Kubernetes

1. **Apply Kubernetes manifests:**
   ```bash
   kubectl apply -f k8s/
   ```

2. **Set up secrets:**
   ```bash
   kubectl create secret generic app-secrets --from-env-file=.env
   ```

## Environment Variables

See `.env.example` for all required environment variables.

Key variables:
- `JWT_SECRET`: Strong secret for JWT signing
- `DB_*`: Database connection details
- `OPENAI_API_KEY`: OpenAI API key for LLM features
- `S3_*`: Object storage configuration

## Health Checks

All services expose a `/health` endpoint:
- API Gateway: http://localhost:3000/health
- Auth Service: http://localhost:3001/health
- Document Service: http://localhost:3002/health
- Ledger Service: http://localhost:3003/health
- Rules Service: http://localhost:3004/health
- Assistant Service: http://localhost:3005/health

## Monitoring

- Prometheus metrics: Available on `/metrics` endpoint (when configured)
- Logs: Structured JSON logs to stdout
- Grafana dashboards: See `monitoring/grafana/` directory

## Scaling

Services are stateless and can be horizontally scaled:
- Run multiple instances behind a load balancer
- Use shared database and message queue
- Configure session storage for auth (Redis recommended)

## Backup

- Database: Use PostgreSQL native backup tools
- Documents: Backup S3/MinIO bucket
- Configuration: Store in version control

## Security Checklist

- [ ] Change all default passwords
- [ ] Use strong JWT secret
- [ ] Enable TLS/HTTPS
- [ ] Configure firewall rules
- [ ] Set up rate limiting
- [ ] Enable audit logging
- [ ] Regular security updates
- [ ] Penetration testing
