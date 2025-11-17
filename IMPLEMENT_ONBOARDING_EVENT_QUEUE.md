# Onboarding Event Publishing – Implementation Plan

## Overview
- Ensure onboarding telemetry events (`onboarding.step.*`, `onboarding.completed`) are actually published to RabbitMQ (or chosen message bus) so downstream services (connector provisioning, analytics) can react.
- Currently `emitOnboardingEvent` in `services/onboarding/src/services/onboardingEvents.ts` only logs the event and invokes a local worker, leaving the message bus unused.

## Backend Scope (services/onboarding)
1. **Messaging infrastructure**
   - Introduce shared RabbitMQ channel utility (reuse existing `services/document-ingest` queue helper if available).
   - Declare exchange (e.g., `onboarding.events`) with topic routing.
   - Each event type maps to routing key `onboarding.<eventType>`.
2. **Event emission**
   - Update `emitOnboardingEvent` to:
     - Serialize payload (JSON) and publish via RabbitMQ with `persistent: true`, header metadata (tenantId, userId, stepName).
     - Fallback to logging if publish fails (with retry/backoff).
   - Keep existing direct call to `connectorProvisioningWorker` for backward compatibility, but plan to migrate that worker to consume from queue.
3. **Consumer(s)**
   - Create dedicated worker (could live in `services/automation` or new `services/onboarding/worker.ts`) subscribing to onboarding exchange:
     - `onboarding.completed` ⇒ call `connectorProvisioningWorker`.
     - `step_completed` ⇒ push analytics event to monitoring/analytics service.
4. **Configuration**
   - Add env vars: `ONBOARDING_RABBITMQ_URL`, `ONBOARDING_EVENTS_EXCHANGE`, `ONBOARDING_EVENTS_QUEUE`.
   - Update `docker-compose` instructions if additional queue needed (RabbitMQ already present).
5. **Reliability**
   - Enable publisher confirms to ensure message durability.
   - Consider DLQ for failed consumers (declare `onboarding.events.dlq` + binding).
6. **Monitoring**
   - Emit metrics (`onboarding.events_published`, `events_failed`) via monitoring service.
   - Add structured logs containing routing key + payload summary.
7. **Testing**
   - Unit tests mocking RabbitMQ channel to assert publish options.
   - Integration test spinning up in-memory RabbitMQ (or using `amqplib` against docker) verifying event flows from HTTP request → queue → worker side effect.

## Frontend Scope
- No UI changes required; events are emitted from backend when API endpoints (e.g., `POST /api/onboarding/steps/:stepName/complete`) are hit.
- Optionally, add admin dashboard metrics panels showing onboarding event counts by step, powered by new event consumers.

## Infrastructure / DevOps
- Ensure RabbitMQ exchange/queue declared via IaC (Helm/ Terraform).
- Define alerting for high DLQ rate.
- Document new env vars and queue names.

## Risks / Open Questions
- Need idempotency for consumers (use event `id` + store processed IDs).
- Consider future migration to shared event bus (Kafka) — keep abstraction so change is easier.

