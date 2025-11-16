/**
 * Mobile API Client with Offline Support
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('mobile-api-client');

const API_BASE = process.env.API_URL || 'https://api.ai-accountant.com';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: unknown;
  requireAuth?: boolean;
  retryOnFailure?: boolean;
}

interface QueuedRequest {
  id: string;
  url: string;
  options: RequestOptions;
  timestamp: number;
  retries: number;
}

class MobileAPIClient {
  private requestQueue: QueuedRequest[] = [];
  private isOnline = true;
  private syncInProgress = false;

  constructor() {
    this.initializeNetworkListener();
    this.loadRequestQueue();
  }

  private initializeNetworkListener(): void {
    NetInfo.addEventListener(state => {
      const wasOffline = !this.isOnline;
      this.isOnline = state.isConnected ?? false;

      if (wasOffline && this.isOnline) {
        logger.info('Network connection restored');
        this.processRequestQueue();
      }
    });
  }

  private async loadRequestQueue(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem('request_queue');
      if (stored) {
        this.requestQueue = JSON.parse(stored);
      }
    } catch (error) {
      logger.error('Failed to load request queue', error);
    }
  }

  private async saveRequestQueue(): Promise<void> {
    try {
      await AsyncStorage.setItem('request_queue', JSON.stringify(this.requestQueue));
    } catch (error) {
      logger.error('Failed to save request queue', error);
    }
  }

  async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const url = `${API_BASE}${endpoint}`;
    const token = await this.getAuthToken();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (options.requireAuth !== false && token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const requestOptions: RequestInit = {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    };

    try {
      if (!this.isOnline) {
        // Queue request for later
        return this.queueRequest<T>(url, options);
      }

      const response = await fetch(url, requestOptions);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      logger.error('API request failed', error, { url, options });

      if (options.retryOnFailure !== false && this.isOnline) {
        // Retry once
        try {
          await new Promise(resolve => setTimeout(resolve, 1000));
          const response = await fetch(url, requestOptions);
          if (response.ok) {
            return await response.json();
          }
        } catch (retryError) {
          logger.error('Retry failed', retryError);
        }
      }

      // Queue if offline or retry failed
      return this.queueRequest<T>(url, options);
    }
  }

  private async queueRequest<T>(url: string, options: RequestOptions): Promise<T> {
    const queuedRequest: QueuedRequest = {
      id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      url,
      options,
      timestamp: Date.now(),
      retries: 0,
    };

    this.requestQueue.push(queuedRequest);
    await this.saveRequestQueue();

    // Return cached data if available
    const cached = await this.getCachedResponse<T>(url);
    if (cached) {
      logger.info('Returning cached data', { url });
      return cached;
    }

    throw new Error('Request queued - no cached data available');
  }

  private async processRequestQueue(): Promise<void> {
    if (this.syncInProgress || !this.isOnline || this.requestQueue.length === 0) {
      return;
    }

    this.syncInProgress = true;
    logger.info('Processing request queue', { count: this.requestQueue.length });

    const queue = [...this.requestQueue];
    this.requestQueue = [];

    for (const queued of queue) {
      try {
        const token = await this.getAuthToken();
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...queued.options.headers,
        };

        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(queued.url, {
          method: queued.options.method || 'GET',
          headers,
          body: queued.options.body ? JSON.stringify(queued.options.body) : undefined,
        });

        if (response.ok) {
          const data = await response.json();
          await this.cacheResponse(queued.url, data);
          logger.info('Queued request succeeded', { id: queued.id });
        } else {
          // Re-queue if failed
          queued.retries++;
          if (queued.retries < 3) {
            this.requestQueue.push(queued);
          }
        }
      } catch (error) {
        logger.error('Failed to process queued request', error, { id: queued.id });
        queued.retries++;
        if (queued.retries < 3) {
          this.requestQueue.push(queued);
        }
      }
    }

    await this.saveRequestQueue();
    this.syncInProgress = false;
  }

  private async getAuthToken(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem('auth_token');
    } catch {
      return null;
    }
  }

  private async getCachedResponse<T>(url: string): Promise<T | null> {
    try {
      const cacheKey = `cache_${btoa(url)}`;
      const cached = await AsyncStorage.getItem(cacheKey);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        // Cache valid for 1 hour
        if (Date.now() - timestamp < 3600000) {
          return data as T;
        }
      }
    } catch {
      // Ignore cache errors
    }
    return null;
  }

  private async cacheResponse(url: string, data: unknown): Promise<void> {
    try {
      const cacheKey = `cache_${btoa(url)}`;
      await AsyncStorage.setItem(
        cacheKey,
        JSON.stringify({ data, timestamp: Date.now() })
      );
    } catch (error) {
      logger.error('Failed to cache response', error);
    }
  }

  // Convenience methods
  async get<T>(endpoint: string, options?: Omit<RequestOptions, 'method'>): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  async post<T>(endpoint: string, body: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'POST', body });
  }

  async put<T>(endpoint: string, body: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'PUT', body });
  }

  async delete<T>(endpoint: string, options?: Omit<RequestOptions, 'method'>): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

export const apiClient = new MobileAPIClient();
