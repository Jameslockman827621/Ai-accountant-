import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { getRedisClient } from './redis';

const logger = createLogger('cache-service');

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  accessCount: number;
  lastAccessed: number;
  ttl: number;
}

/**
 * Intelligent cache with automatic invalidation and LRU eviction
 */
export class IntelligentCache {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private maxSize: number = 10000;
  private defaultTTL: number = 3600000; // 1 hour

  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);
    if (!entry) {
      // Try Redis
      const redis = await getRedisClient();
      if (redis) {
        const cached = await redis.get(key);
        if (cached) {
          return JSON.parse(cached) as T;
        }
      }
      return null;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    // Update access stats
    entry.accessCount++;
    entry.lastAccessed = Date.now();

    return entry.data as T;
  }

  async set<T>(key: string, data: T, ttl?: number): Promise<void> {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      accessCount: 1,
      lastAccessed: Date.now(),
      ttl: ttl || this.defaultTTL,
    };

    // Evict if needed
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    this.cache.set(key, entry);

    // Also cache in Redis
    const redis = await getRedisClient();
    if (redis) {
      await redis.setEx(key, Math.floor(entry.ttl / 1000), JSON.stringify(data));
    }
  }

  async invalidate(pattern: string): Promise<void> {
    // Invalidate matching keys
    const keysToDelete: string[] = [];
    for (const key of this.cache.keys()) {
      if (matchPattern(key, pattern)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key));

    // Invalidate in Redis
    const redis = await getRedisClient();
    if (redis) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }

    logger.info('Cache invalidated', { pattern, count: keysToDelete.length });
  }

  async invalidateTenant(tenantId: TenantId): Promise<void> {
    await this.invalidate(`*:${tenantId}:*`);
  }

  private evictLRU(): void {
    // Find least recently used entry
    let lruKey: string | null = null;
    let lruTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < lruTime) {
        lruTime = entry.lastAccessed;
        lruKey = key;
      }
    }

    if (lruKey) {
      this.cache.delete(lruKey);
      logger.debug('Cache entry evicted', { key: lruKey });
    }
  }

  getStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
  } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: 0, // Would track hits/misses in production
    };
  }
}

function matchPattern(key: string, pattern: string): boolean {
  // Simple pattern matching: * matches any characters
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
  return regex.test(key);
}

export const intelligentCache = new IntelligentCache();
