/**
 * Enhanced Redis Caching with advanced features
 */

import { createLogger } from '@ai-accountant/shared-utils';
import { createClient, RedisClientType } from 'redis';

const logger = createLogger('enhanced-redis');

export interface CacheConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  ttl?: number; // Default TTL in seconds
  maxRetries?: number;
  retryDelay?: number;
}

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  tags?: string[]; // Cache tags for invalidation
  compress?: boolean; // Compress large values
}

export class EnhancedRedisCache {
  private client: RedisClientType | null = null;
  private config: CacheConfig;
  private connected = false;

  constructor(config: CacheConfig) {
    this.config = {
      ttl: 3600,
      maxRetries: 3,
      retryDelay: 1000,
      ...config,
    };
  }

  async connect(): Promise<void> {
    if (this.connected && this.client) {
      return;
    }

    try {
      this.client = createClient({
        socket: {
          host: this.config.host,
          port: this.config.port,
          reconnectStrategy: (retries) => {
            if (retries > (this.config.maxRetries || 3)) {
              return new Error('Max retries reached');
            }
            return this.config.retryDelay || 1000;
          },
        },
        password: this.config.password,
        database: this.config.db || 0,
      });

      this.client.on('error', (err) => {
        logger.error('Redis client error', err);
        this.connected = false;
      });

      this.client.on('connect', () => {
        logger.info('Redis connected');
        this.connected = true;
      });

      this.client.on('disconnect', () => {
        logger.warn('Redis disconnected');
        this.connected = false;
      });

      await this.client.connect();
      this.connected = true;
    } catch (error) {
      logger.error('Failed to connect to Redis', error);
      throw error;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.connected || !this.client) {
      await this.connect();
    }

    try {
      const value = await this.client!.get(key);
      if (!value) {
        return null;
      }

      // Handle compressed values
      if (value.startsWith('compressed:')) {
        const decompressed = this.decompress(value.substring(11));
        return JSON.parse(decompressed) as T;
      }

      return JSON.parse(value) as T;
    } catch (error) {
      logger.error('Failed to get from cache', error, { key });
      return null;
    }
  }

  async set(key: string, value: unknown, options?: CacheOptions): Promise<void> {
    if (!this.connected || !this.client) {
      await this.connect();
    }

    try {
      const serialized = JSON.stringify(value);
      const shouldCompress = options?.compress || serialized.length > 10000;
      const finalValue = shouldCompress ? `compressed:${this.compress(serialized)}` : serialized;

      const ttl = options?.ttl || this.config.ttl || 3600;

      await this.client!.setEx(key, ttl, finalValue);

      // Store tags for invalidation
      if (options?.tags && options.tags.length > 0) {
        for (const tag of options.tags) {
          await this.client!.sAdd(`tag:${tag}`, key);
          await this.client!.expire(`tag:${tag}`, ttl);
        }
      }
    } catch (error) {
      logger.error('Failed to set cache', error, { key });
    }
  }

  async delete(key: string): Promise<void> {
    if (!this.connected || !this.client) {
      return;
    }

    try {
      await this.client!.del(key);
    } catch (error) {
      logger.error('Failed to delete from cache', error, { key });
    }
  }

  async invalidateByTag(tag: string): Promise<number> {
    if (!this.connected || !this.client) {
      return 0;
    }

    try {
      const keys = await this.client!.sMembers(`tag:${tag}`);
      if (keys.length === 0) {
        return 0;
      }

      const deleted = await this.client!.del(keys);
      await this.client!.del(`tag:${tag}`);

      return deleted;
    } catch (error) {
      logger.error('Failed to invalidate by tag', error, { tag });
      return 0;
    }
  }

  async invalidatePattern(pattern: string): Promise<number> {
    if (!this.connected || !this.client) {
      return 0;
    }

    try {
      const keys: string[] = [];
      for await (const key of this.client!.scanIterator({ MATCH: pattern })) {
        keys.push(key);
      }

      if (keys.length === 0) {
        return 0;
      }

      return await this.client!.del(keys);
    } catch (error) {
      logger.error('Failed to invalidate pattern', error, { pattern });
      return 0;
    }
  }

  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    options?: CacheOptions
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await fetcher();
    await this.set(key, value, options);
    return value;
  }

  async increment(key: string, by: number = 1): Promise<number> {
    if (!this.connected || !this.client) {
      await this.connect();
    }

    try {
      return await this.client!.incrBy(key, by);
    } catch (error) {
      logger.error('Failed to increment', error, { key });
      throw error;
    }
  }

  async decrement(key: string, by: number = 1): Promise<number> {
    return this.increment(key, -by);
  }

  async exists(key: string): Promise<boolean> {
    if (!this.connected || !this.client) {
      return false;
    }

    try {
      const result = await this.client!.exists(key);
      return result > 0;
    } catch (error) {
      logger.error('Failed to check existence', error, { key });
      return false;
    }
  }

  async flush(): Promise<void> {
    if (!this.connected || !this.client) {
      return;
    }

    try {
      await this.client!.flushDb();
    } catch (error) {
      logger.error('Failed to flush cache', error);
    }
  }

  async getStats(): Promise<{
    connected: boolean;
    memory?: Record<string, string>;
    keyspace?: Record<string, string>;
  }> {
    if (!this.connected || !this.client) {
      return { connected: false };
    }

    try {
      const info = await this.client!.info('memory');
      const keyspace = await this.client!.info('keyspace');

      return {
        connected: true,
        memory: this.parseInfo(info),
        keyspace: this.parseInfo(keyspace),
      };
    } catch (error) {
      logger.error('Failed to get stats', error);
      return { connected: true };
    }
  }

  private parseInfo(info: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of info.split('\n')) {
      if (line.includes(':')) {
        const [key, value] = line.split(':');
        if (key && value) {
          result[key.trim()] = value.trim();
        }
      }
    }
    return result;
  }

  private compress(data: string): string {
    // Simple compression - in production use zlib or similar
    return Buffer.from(data).toString('base64');
  }

  private decompress(data: string): string {
    return Buffer.from(data, 'base64').toString('utf8');
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.connected = false;
    }
  }
}

export const createRedisCache = (config: CacheConfig): EnhancedRedisCache => {
  return new EnhancedRedisCache(config);
};
