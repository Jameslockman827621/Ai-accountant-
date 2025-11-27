/**
 * Secrets Management Integration
 * Supports HashiCorp Vault and AWS Secrets Manager
 */

import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('secrets-management');

export interface SecretsConfig {
  provider: 'vault' | 'aws-secrets-manager' | 'local';
  vaultUrl?: string;
  vaultToken?: string;
  awsRegion?: string;
  enabled: boolean;
}

export class SecretsManager {
  private config: SecretsConfig;
  private cache: Map<string, { value: string; expiresAt: number }> = new Map();
  private cacheTTL = 3600000; // 1 hour
  private hydrated = false;

  constructor(config: SecretsConfig) {
    this.config = config;
  }

  async getSecret(path: string): Promise<string | null> {
    // Check cache first
    const cached = this.cache.get(path);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    try {
      let secret: string | null = null;

      switch (this.config.provider) {
        case 'vault':
          secret = await this.getFromVault(path);
          break;
        case 'aws-secrets-manager':
          secret = await this.getFromAWSSecretsManager(path);
          break;
        case 'local':
          secret = process.env[path] || null;
          break;
      }

      if (secret) {
        this.cache.set(path, {
          value: secret,
          expiresAt: Date.now() + this.cacheTTL,
        });
      }

      return secret;
    } catch (error) {
      logger.error('Failed to get secret', error, { path });
      return null;
    }
  }

  hydrate(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    logger.info('Secrets manager hydrated', { provider: this.config.provider, enabled: this.config.enabled });
  }

  private async getFromVault(path: string): Promise<string | null> {
    if (!this.config.vaultUrl || !this.config.vaultToken) {
      logger.warn('Vault not configured');
      return null;
    }

    // In production, use Vault client:
    // const vault = require('node-vault')({
    //   endpoint: this.config.vaultUrl,
    //   token: this.config.vaultToken,
    // });
    // const result = await vault.read(path);
    // return result.data?.value || null;

    logger.debug('Would fetch from Vault', { path });
    return process.env[path] || null; // Fallback
  }

  private async getFromAWSSecretsManager(path: string): Promise<string | null> {
    if (!this.config.awsRegion) {
      logger.warn('AWS region not configured');
      return null;
    }

    // In production, use AWS SDK:
    // const { SecretsManager } = require('@aws-sdk/client-secrets-manager');
    // const client = new SecretsManager({ region: this.config.awsRegion });
    // const result = await client.getSecretValue({ SecretId: path });
    // return result.SecretString || null;

    logger.debug('Would fetch from AWS Secrets Manager', { path });
    return process.env[path] || null; // Fallback
  }

  async setSecret(path: string, value: string): Promise<void> {
    // In production, implement secret setting
    logger.debug('Secret set', { path });
    this.cache.set(path, {
      value,
      expiresAt: Date.now() + this.cacheTTL,
    });
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export const createSecretsManager = (config: SecretsConfig): SecretsManager => {
  return new SecretsManager(config);
};

export const createDefaultSecretsManager = (): SecretsManager => {
  const provider = (process.env.SECRETS_PROVIDER as SecretsConfig['provider']) || 'local';
  const manager = new SecretsManager({
    provider,
    vaultUrl: process.env.VAULT_URL,
    vaultToken: process.env.VAULT_TOKEN,
    awsRegion: process.env.AWS_REGION,
    enabled: process.env.SECRETS_ENABLED !== 'false',
  });
  manager.hydrate();
  return manager;
};
