import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('cache-service');

// Redis client (simplified - in production use ioredis)
class RedisCache {
  private cache: Map<string, { value: unknown; expiry: number }> = new Map();

  getKeys(): string[] {
    return Array.from(this.cache.keys());
  }

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

  async set(key: string, value: unknown, ttlSeconds: number = 3600): Promise<void> {
    const expiry = Date.now() + ttlSeconds * 1000;
    this.cache.set(key, { value, expiry });
    logger.debug('Cache set', { key, ttlSeconds });
  }

  async del(key: string): Promise<void> {
    this.cache.delete(key);
    logger.debug('Cache deleted', { key });
  }

  async exists(key: string): Promise<boolean> {
    const item = this.cache.get(key);
    if (!item) return false;
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  async flush(): Promise<void> {
    this.cache.clear();
    logger.info('Cache flushed');
  }
}

export const redisCache = new RedisCache();

// Cache decorator
export function cached(ttlSeconds: number = 3600) {
  return function (target: unknown, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      const cacheKey = `${target.constructor.name}:${propertyName}:${JSON.stringify(args)}`;
      
      const cached = await redisCache.get(cacheKey);
      if (cached !== null) {
        return cached;
      }

      const result = await method.apply(this, args);
      await redisCache.set(cacheKey, result, ttlSeconds);
      
      return result;
    };
  };
}
