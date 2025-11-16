import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('circuit-breaker');

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerConfig {
  serviceName: string;
  endpoint: string;
  failureThreshold?: number;
  successThreshold?: number;
  timeoutSeconds?: number;
}

/**
 * Circuit Breaker Service (Chunk 4)
 * Implements circuit breaker pattern for external API calls
 */
export class CircuitBreakerService {
  /**
   * Execute function with circuit breaker protection
   */
  async execute<T>(
    config: CircuitBreakerConfig,
    fn: () => Promise<T>
  ): Promise<T> {
    const state = await this.getState(config.serviceName, config.endpoint);

    if (state === 'open') {
      // Check if timeout has passed
      const breaker = await this.getBreaker(config.serviceName, config.endpoint);
      if (breaker && breaker.openedAt) {
        const timeoutMs = (config.timeoutSeconds || 60) * 1000;
        const elapsed = Date.now() - breaker.openedAt.getTime();
        if (elapsed >= timeoutMs) {
          // Move to half-open
          await this.setState(config.serviceName, config.endpoint, 'half_open');
        } else {
          throw new Error(`Circuit breaker is OPEN for ${config.serviceName}:${config.endpoint}`);
        }
      } else {
        throw new Error(`Circuit breaker is OPEN for ${config.serviceName}:${config.endpoint}`);
      }
    }

    try {
      const result = await fn();

      // Record success
      await this.recordSuccess(config.serviceName, config.endpoint, config.successThreshold || 2);

      return result;
    } catch (error) {
      // Record failure
      await this.recordFailure(
        config.serviceName,
        config.endpoint,
        config.failureThreshold || 5
      );

      throw error;
    }
  }

  /**
   * Get circuit breaker state
   */
  async getState(serviceName: string, endpoint: string): Promise<CircuitState> {
    const breaker = await this.getBreaker(serviceName, endpoint);
    return breaker?.state || 'closed';
  }

  /**
   * Get circuit breaker record
   */
  private async getBreaker(serviceName: string, endpoint: string): Promise<{
    id: string;
    state: CircuitState;
    failureCount: number;
    successCount: number;
    lastFailureAt: Date | null;
    lastSuccessAt: Date | null;
    openedAt: Date | null;
    failureThreshold: number;
    successThreshold: number;
    timeoutSeconds: number;
  } | null> {
    const result = await db.query<{
      id: string;
      state: string;
      failure_count: number;
      success_count: number;
      last_failure_at: Date | null;
      last_success_at: Date | null;
      opened_at: Date | null;
      failure_threshold: number;
      success_threshold: number;
      timeout_seconds: number;
    }>(
      `SELECT * FROM circuit_breaker_states
       WHERE service_name = $1 AND endpoint = $2`,
      [serviceName, endpoint]
    );

    if (result.rows.length === 0) {
      // Create default
      await db.query(
        `INSERT INTO circuit_breaker_states (
          id, service_name, endpoint, state, failure_threshold, success_threshold, timeout_seconds,
          last_state_change_at, updated_at
        ) VALUES (
          gen_random_uuid(), $1, $2, 'closed', 5, 2, 60, NOW(), NOW()
        )`,
        [serviceName, endpoint]
      );

      return {
        id: '',
        state: 'closed',
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        openedAt: null,
        failureThreshold: 5,
        successThreshold: 2,
        timeoutSeconds: 60,
      };
    }

    const row = result.rows[0];
    return {
      id: row.id,
      state: row.state as CircuitState,
      failureCount: row.failure_count,
      successCount: row.success_count,
      lastFailureAt: row.last_failure_at,
      lastSuccessAt: row.last_success_at,
      openedAt: row.opened_at,
      failureThreshold: row.failure_threshold,
      successThreshold: row.success_threshold,
      timeoutSeconds: row.timeout_seconds,
    };
  }

  /**
   * Set circuit breaker state
   */
  private async setState(
    serviceName: string,
    endpoint: string,
    state: CircuitState
  ): Promise<void> {
    await db.query(
      `UPDATE circuit_breaker_states
       SET state = $1,
           last_state_change_at = NOW(),
           ${state === 'open' ? 'opened_at = NOW(),' : ''}
           updated_at = NOW()
       WHERE service_name = $2 AND endpoint = $3`,
      [state, serviceName, endpoint]
    );

    logger.info('Circuit breaker state changed', { serviceName, endpoint, state });
  }

  /**
   * Record success
   */
  private async recordSuccess(
    serviceName: string,
    endpoint: string,
    successThreshold: number
  ): Promise<void> {
    const breaker = await this.getBreaker(serviceName, endpoint);
    if (!breaker) {
      return;
    }

    const newSuccessCount = breaker.successCount + 1;

    await db.query(
      `UPDATE circuit_breaker_states
       SET success_count = $1,
           last_success_at = NOW(),
           updated_at = NOW()
       WHERE service_name = $2 AND endpoint = $3`,
      [newSuccessCount, serviceName, endpoint]
    );

    // If in half-open and threshold reached, close circuit
    if (breaker.state === 'half_open' && newSuccessCount >= successThreshold) {
      await this.setState(serviceName, endpoint, 'closed');
      await db.query(
        `UPDATE circuit_breaker_states
         SET success_count = 0,
             failure_count = 0,
             updated_at = NOW()
         WHERE service_name = $1 AND endpoint = $2`,
        [serviceName, endpoint]
      );
    }
  }

  /**
   * Record failure
   */
  private async recordFailure(
    serviceName: string,
    endpoint: string,
    failureThreshold: number
  ): Promise<void> {
    const breaker = await this.getBreaker(serviceName, endpoint);
    if (!breaker) {
      return;
    }

    const newFailureCount = breaker.failureCount + 1;

    await db.query(
      `UPDATE circuit_breaker_states
       SET failure_count = $1,
           last_failure_at = NOW(),
           updated_at = NOW()
       WHERE service_name = $2 AND endpoint = $3`,
      [newFailureCount, serviceName, endpoint]
    );

    // If threshold reached, open circuit
    if (newFailureCount >= failureThreshold && breaker.state !== 'open') {
      await this.setState(serviceName, endpoint, 'open');
    }

    // Reset success count if in half-open
    if (breaker.state === 'half_open') {
      await db.query(
        `UPDATE circuit_breaker_states
         SET success_count = 0,
             updated_at = NOW()
         WHERE service_name = $1 AND endpoint = $2`,
        [serviceName, endpoint]
      );
    }
  }

  /**
   * Get all open circuit breakers
   */
  async getOpenCircuits(): Promise<Array<{
    serviceName: string;
    endpoint: string;
    openedAt: Date | null;
  }>> {
    const result = await db.query<{
      service_name: string;
      endpoint: string;
      opened_at: Date | null;
    }>(
      `SELECT service_name, endpoint, opened_at
       FROM circuit_breaker_states
       WHERE state = 'open'
       ORDER BY opened_at DESC`
    );

    return result.rows.map(row => ({
      serviceName: row.service_name,
      endpoint: row.endpoint,
      openedAt: row.opened_at,
    }));
  }
}

export const circuitBreakerService = new CircuitBreakerService();
