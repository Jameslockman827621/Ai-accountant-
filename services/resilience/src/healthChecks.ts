import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';

const logger = createLogger('resilience-service');

// Health Check System
export class HealthCheckSystem {
  async checkDatabase(): Promise<{ healthy: boolean; latency: number }> {
    const start = Date.now();
    try {
      await db.query('SELECT 1');
      const latency = Date.now() - start;
      return { healthy: true, latency };
    } catch (error) {
      logger.error('Database health check failed', error instanceof Error ? error : new Error(String(error)));
      return { healthy: false, latency: Date.now() - start };
    }
  }

  async checkS3(): Promise<{ healthy: boolean; latency: number }> {
    const start = Date.now();
    try {
      // In production, check S3 connectivity
      const latency = Date.now() - start;
      return { healthy: true, latency };
    } catch (error) {
      return { healthy: false, latency: Date.now() - start };
    }
  }

  async checkRabbitMQ(): Promise<{ healthy: boolean; latency: number }> {
    const start = Date.now();
    try {
      // In production, check RabbitMQ connectivity
      const latency = Date.now() - start;
      return { healthy: true, latency };
    } catch (error) {
      return { healthy: false, latency: Date.now() - start };
    }
  }

  async checkChromaDB(): Promise<{ healthy: boolean; latency: number }> {
    const start = Date.now();
    try {
      // In production, check ChromaDB connectivity
      const latency = Date.now() - start;
      return { healthy: true, latency };
    } catch (error) {
      return { healthy: false, latency: Date.now() - start };
    }
  }

  async performFullHealthCheck(): Promise<{
    overall: 'healthy' | 'degraded' | 'unhealthy';
    checks: Record<string, { healthy: boolean; latency: number }>;
  }> {
    const checks = {
      database: await this.checkDatabase(),
      s3: await this.checkS3(),
      rabbitmq: await this.checkRabbitMQ(),
      chromadb: await this.checkChromaDB(),
    };

    const allHealthy = Object.values(checks).every(c => c.healthy);
    const anyUnhealthy = Object.values(checks).some(c => !c.healthy);

    let overall: 'healthy' | 'degraded' | 'unhealthy';
    if (allHealthy) {
      overall = 'healthy';
    } else if (anyUnhealthy) {
      overall = 'unhealthy';
    } else {
      overall = 'degraded';
    }

    return { overall, checks };
  }
}

export const healthCheckSystem = new HealthCheckSystem();
