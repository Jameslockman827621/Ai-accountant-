import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';

const logger = createLogger('onfido-kyc');

export interface OnfidoConfig {
  apiToken: string;
  environment: 'sandbox' | 'production';
  webhookToken?: string;
}

export interface OnfidoApplicant {
  id: string;
  created_at: string;
  first_name: string;
  last_name: string;
  email?: string;
}

export interface OnfidoCheck {
  id: string;
  status: string;
  type: string;
  result?: string;
  created_at: string;
  completed_at?: string;
}

export interface OnfidoDocument {
  id: string;
  type: string;
  side?: string;
  file_name: string;
  file_type: string;
  file_size: number;
}

interface OnfidoApplicantResponse {
  applicant: OnfidoApplicant;
}

interface OnfidoDocumentResponse {
  document: OnfidoDocument;
}

interface OnfidoCheckResponse {
  check: OnfidoCheck;
}

interface OnfidoErrorResponse {
  error?: {
    message?: string;
  };
}

export class OnfidoKYCService {
  private config: OnfidoConfig;
  private baseUrl: string;

  constructor(config: OnfidoConfig) {
    this.config = config;
    this.baseUrl = config.environment === 'production'
      ? 'https://api.onfido.com/v3'
      : 'https://api.sandbox.onfido.com/v3';
  }

  /**
   * Create an applicant
   */
  async createApplicant(
    tenantId: TenantId,
    userId: UserId,
    firstName: string,
    lastName: string,
    email?: string
  ): Promise<OnfidoApplicant> {
    try {
      const response = await fetch(`${this.baseUrl}/applicants`, {
        method: 'POST',
        headers: {
          Authorization: `Token token=${this.config.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          email,
          location: {
            ip_address: '127.0.0.1', // Would get from request in production
            country_of_residence: 'GB',
          },
        }),
      });

        if (!response.ok) {
          const errorBody = (await response.json()) as OnfidoErrorResponse;
          throw new Error(`Onfido API error: ${errorBody.error?.message || 'Unknown error'}`);
        }

        const data = (await response.json()) as OnfidoApplicantResponse;
      logger.info('Onfido applicant created', {
          applicantId: data.applicant.id,
        tenantId,
        userId,
      });

      return {
          id: data.applicant.id,
          created_at: data.applicant.created_at,
          first_name: data.applicant.first_name,
          last_name: data.applicant.last_name,
          email: data.applicant.email,
      };
    } catch (error) {
      logger.error('Failed to create Onfido applicant', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Upload a document
   */
  async uploadDocument(
    applicantId: string,
    file: Buffer,
    fileName: string,
    fileType: string,
    documentType: string,
    side?: 'front' | 'back'
  ): Promise<OnfidoDocument> {
    try {
      // First, create document upload
      const formData = new FormData();
      const blob = new Blob([file], { type: fileType });
      formData.append('file', blob, fileName);
      formData.append('type', documentType);
      if (side) {
        formData.append('side', side);
      }

      const response = await fetch(`${this.baseUrl}/documents`, {
        method: 'POST',
        headers: {
          Authorization: `Token token=${this.config.apiToken}`,
        },
        body: formData,
      });

        if (!response.ok) {
          const errorBody = (await response.json()) as OnfidoErrorResponse;
          throw new Error(`Onfido API error: ${errorBody.error?.message || 'Unknown error'}`);
        }

        const data = (await response.json()) as OnfidoDocumentResponse;
      logger.info('Onfido document uploaded', {
          documentId: data.document.id,
        applicantId,
        type: documentType,
      });

      return {
          id: data.document.id,
          type: data.document.type,
          side: data.document.side,
          file_name: data.document.file_name,
          file_type: data.document.file_type,
          file_size: data.document.file_size,
      };
    } catch (error) {
      logger.error('Failed to upload Onfido document', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Create a check
   */
  async createCheck(
    applicantId: string,
    reportNames: string[] = ['identity_enhanced', 'document']
  ): Promise<OnfidoCheck> {
    try {
      const response = await fetch(`${this.baseUrl}/checks`, {
        method: 'POST',
        headers: {
          Authorization: `Token token=${this.config.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          applicant_id: applicantId,
          report_names: reportNames,
        }),
      });

        if (!response.ok) {
          const errorBody = (await response.json()) as OnfidoErrorResponse;
          throw new Error(`Onfido API error: ${errorBody.error?.message || 'Unknown error'}`);
        }

        const data = (await response.json()) as OnfidoCheckResponse;
      logger.info('Onfido check created', {
          checkId: data.check.id,
        applicantId,
          status: data.check.status,
      });

      return {
          id: data.check.id,
          status: data.check.status,
          type: data.check.type,
          result: data.check.result,
          created_at: data.check.created_at,
          completed_at: data.check.completed_at,
      };
    } catch (error) {
      logger.error('Failed to create Onfido check', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Get check status
   */
  async getCheck(checkId: string): Promise<OnfidoCheck> {
    try {
      const response = await fetch(`${this.baseUrl}/checks/${checkId}`, {
        headers: {
          Authorization: `Token token=${this.config.apiToken}`,
        },
      });

        if (!response.ok) {
          const errorBody = (await response.json()) as OnfidoErrorResponse;
          throw new Error(`Onfido API error: ${errorBody.error?.message || 'Unknown error'}`);
        }

        const data = (await response.json()) as OnfidoCheckResponse;
        return {
          id: data.check.id,
          status: data.check.status,
          type: data.check.type,
          result: data.check.result,
          created_at: data.check.created_at,
          completed_at: data.check.completed_at,
      };
    } catch (error) {
      logger.error('Failed to get Onfido check', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Handle webhook from Onfido
   */
  async handleWebhook(
    webhookData: {
      payload: {
        resource_type: string;
        action: string;
        object: {
          id: string;
          status: string;
          result?: string;
          [key: string]: unknown;
        };
      };
    },
    token: string
  ): Promise<void> {
    // Verify webhook token
    if (this.config.webhookToken && token !== this.config.webhookToken) {
      throw new Error('Invalid webhook token');
    }

    const payload = webhookData.payload;
    logger.info('Onfido webhook received', {
      resourceType: payload.resource_type,
      action: payload.action,
      objectId: payload.object.id,
    });

    // Handle different resource types
    switch (payload.resource_type) {
      case 'check':
        if (payload.action === 'check.completed') {
          logger.info('Onfido check completed', {
            checkId: payload.object.id,
            result: payload.object.result,
          });
          // Trigger downstream processing
        }
        break;

      case 'document':
        if (payload.action === 'document.created') {
          logger.info('Onfido document created', { documentId: payload.object.id });
        }
        break;

      default:
        logger.warn('Unknown Onfido resource type', { resourceType: payload.resource_type });
    }
  }
}

export function createOnfidoService(config: OnfidoConfig): OnfidoKYCService {
  return new OnfidoKYCService(config);
}
