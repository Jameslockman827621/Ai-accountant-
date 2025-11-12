import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('cache-service');

// Simplified Redis client - in production, use ioredis or node-redis
class RedisCache {
  private cache: Map<string, { value: unknown; expiry: number }> = new Map();
  private readonly defaultTTL = 3600; // 1 hour

  async get<T>(key: string): Promise<T | null> {
    const item = this.cache.get(key);
    
    if (!item) {
      return null;
    }

    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }

    return item.value as T;
  }

  async set(key: string, value: unknown, ttl: number = this.defaultTTL): Promise<void> {
    const expiry = Date.now() + ttl * 1000;
    this.cache.set(key, { value, expiry });
  }

  async del(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    const item = this.cache.get(key);
    if (!item) {
      return false;
    }

    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp(pattern.replace('*', '.*'));
    return Array.from(this.cache.keys()).filter(key => regex.test(key));
  }

  async flush(): Promise<void> {
    this.cache.clear();
  }

  // Cleanup expired entries periodically
  startCleanup(interval: number = 60000): void {
    setInterval(() => {
      const now = Date.now();
      for (const [key, item] of this.cache.entries()) {
        if (now > item.expiry) {
          this.cache.delete(key);
        }
      }
    }, interval);
  }
}

export const redisCache = new RedisCache();

// Start cleanup on initialization
redisCache.startCleanup();

export async function cacheGet<T>(key: string): Promise<T | null> {
  return redisCache.get<T>(key);
}

export async function cacheSet(key: string, value: unknown, ttl?: number): Promise<void> {
  return redisCache.set(key, value, ttl);
}

export async function cacheDel(key: string): Promise<void> {
  return redisCache.del(key);
}

export async function cacheInvalidate(pattern: string): Promise<void> {
  const keys = await redisCache.keys(pattern);
  for (const key of keys) {
    await redisCache.del(key);
  }
}
