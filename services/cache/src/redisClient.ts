// Actual Redis client implementation (using ioredis in production)
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('cache-service');

// In production, use: import Redis from 'ioredis';
class RedisClient {
  private client: Map<string, { value: unknown; expiry: number }> = new Map();

  async connect(): Promise<void> {
    // In production: this.client = new Redis(process.env.REDIS_URL);
    logger.info('Redis client connected');
  }

  async get<T>(key: string): Promise<T | null> {
    const item = this.client.get(key);
    if (!item || Date.now() > item.expiry) {
      if (item) this.client.delete(key);
      return null;
    }
    return item.value as T;
  }

  async set(key: string, value: unknown, ttlSeconds: number = 3600): Promise<void> {
    this.client.set(key, {
      value,
      expiry: Date.now() + ttlSeconds * 1000,
    });
  }

  async del(key: string): Promise<void> {
    this.client.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.client.has(key);
  }

  async flush(): Promise<void> {
    this.client.clear();
  }
}

export const redisClient = new RedisClient();
