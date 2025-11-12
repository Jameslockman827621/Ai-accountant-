import { gdprCompliance } from './gdpr';
import { createLogger } from '@ai-accountant/shared-utils';
import { UserId } from '@ai-accountant/shared-types';

const logger = createLogger('compliance-service');

// GDPR Consent Management UI Backend
export class GDPRConsentUI {
  async getConsentStatus(userId: UserId): Promise<{
    marketing: boolean;
    analytics: boolean;
    dataSharing: boolean;
    lastUpdated: Date | null;
  }> {
    // In production, fetch from database
    return {
      marketing: true,
      analytics: true,
      dataSharing: false,
      lastUpdated: new Date(),
    };
  }

  async updateConsent(
    userId: UserId,
    consentType: string,
    granted: boolean
  ): Promise<void> {
    await gdprCompliance.recordConsent(userId, consentType, granted);
    logger.info('Consent updated', { userId, consentType, granted });
  }

  async requestDataExport(userId: UserId): Promise<{
    exportId: string;
    status: 'pending' | 'processing' | 'ready' | 'expired';
    downloadUrl?: string;
  }> {
    const exportId = crypto.randomUUID();
    
    // In production, queue export job
    logger.info('Data export requested', { userId, exportId });
    
    return {
      exportId,
      status: 'pending',
    };
  }

  async requestDataDeletion(userId: UserId): Promise<{
    deletionId: string;
    status: 'pending' | 'processing' | 'completed';
  }> {
    const deletionId = crypto.randomUUID();
    
    // In production, queue deletion job
    await gdprCompliance.deleteUserData(userId);
    
    return {
      deletionId,
      status: 'processing',
    };
  }
}

export const gdprConsentUI = new GDPRConsentUI();
