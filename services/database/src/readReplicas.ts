import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('database-service');

// Read Replica Support
export class ReadReplicaManager {
  private readReplicas: string[] = [];

  constructor() {
    // In production, get from environment or service discovery
    this.readReplicas = (process.env.DATABASE_READ_REPLICAS || '').split(',').filter(Boolean);
  }

  getReadConnection(): string {
    if (this.readReplicas.length === 0) {
      // Fallback to primary
      return process.env.DATABASE_URL || '';
    }

    // Round-robin selection
    const index = Math.floor(Math.random() * this.readReplicas.length);
    return this.readReplicas[index] || process.env.DATABASE_URL || '';
  }

  async checkReplicaHealth(replicaUrl: string): Promise<boolean> {
    try {
      // In production, check replica connectivity
      logger.debug('Replica health check', { replicaUrl });
      return true;
    } catch (error) {
      logger.error('Replica health check failed', {
        replicaUrl,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return false;
    }
  }
}

export const readReplicaManager = new ReadReplicaManager();
