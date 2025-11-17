/**
 * Secret Management Service
 * Integrates with Vault/AWS Parameter Store for secure secret management
 */

import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('secrets');

export interface SecretConfig {
  key: string;
  required: boolean;
  defaultValue?: string;
}

class SecretManager {
  private cache: Map<string, { value: string; expiresAt: number }> = new Map();
  private cacheTTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Get secret from Vault
   */
  async getFromVault(path: string): Promise<string | null> {
    const vaultAddr = process.env.VAULT_ADDR || 'http://localhost:8200';
    const vaultToken = process.env.VAULT_TOKEN;

    if (!vaultToken) {
      logger.warn('Vault token not configured, falling back to environment variables');
      return null;
    }

    try {
      // Check cache first
      const cached = this.cache.get(path);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.value;
      }

      const response = await fetch(`${vaultAddr}/v1/${path}`, {
        headers: {
          'X-Vault-Token': vaultToken,
        },
      });

      if (!response.ok) {
        throw new Error(`Vault API error: ${response.statusText}`);
      }

      const data = await response.json();
      const value = data.data?.value || data.data?.data?.value;

      if (value) {
        // Cache the value
        this.cache.set(path, {
          value,
          expiresAt: Date.now() + this.cacheTTL,
        });
      }

      return value || null;
    } catch (error) {
      logger.error(`Failed to get secret from Vault: ${path}`, error);
      return null;
    }
  }

  /**
   * Get secret from AWS Parameter Store
   */
  async getFromParameterStore(name: string, decrypt: boolean = true): Promise<string | null> {
    const awsRegion = process.env.AWS_REGION || 'us-east-1';

    try {
      // Check cache first
      const cached = this.cache.get(name);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.value;
      }

      // In production, would use AWS SDK
      // For now, return null to fall back to environment variables
      logger.warn('AWS Parameter Store not fully implemented, using environment variables');
      return null;
    } catch (error) {
      logger.error(`Failed to get secret from Parameter Store: ${name}`, error);
      return null;
    }
  }

  /**
   * Get secret with fallback chain: Vault -> Parameter Store -> Environment Variable
   */
  async getSecret(
    key: string,
    config?: { vaultPath?: string; parameterStoreName?: string; envVar?: string }
  ): Promise<string> {
    // Try Vault first
    if (config?.vaultPath) {
      const vaultValue = await this.getFromVault(config.vaultPath);
      if (vaultValue) {
        return vaultValue;
      }
    }

    // Try Parameter Store
    if (config?.parameterStoreName) {
      const paramValue = await this.getFromParameterStore(config.parameterStoreName);
      if (paramValue) {
        return paramValue;
      }
    }

    // Fall back to environment variable
    const envVar = config?.envVar || key;
    const envValue = process.env[envVar];

    if (!envValue) {
      throw new Error(`Secret not found: ${key} (checked Vault, Parameter Store, and env var ${envVar})`);
    }

    return envValue;
  }

  /**
   * Clear cache (useful for testing or after secret rotation)
   */
  clearCache() {
    this.cache.clear();
  }
}

export const secretManager = new SecretManager();

/**
 * Get required secrets on startup
 */
export async function initializeSecrets(secrets: SecretConfig[]) {
  const results: Record<string, string> = {};

  for (const secret of secrets) {
    try {
      const value = await secretManager.getSecret(secret.key, {
        envVar: secret.key,
      });
      results[secret.key] = value;
    } catch (error) {
      if (secret.required) {
        throw new Error(`Required secret missing: ${secret.key}`);
      }
      if (secret.defaultValue) {
        results[secret.key] = secret.defaultValue;
      }
    }
  }

  return results;
}
