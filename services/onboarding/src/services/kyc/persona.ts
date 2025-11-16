import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';

const logger = createLogger('persona-kyc');

export interface PersonaConfig {
  apiKey: string;
  environment: 'sandbox' | 'production';
  webhookSecret?: string;
}

export interface PersonaInquiry {
  id: string;
  status: string;
  reference_id: string;
  created_at: string;
  completed_at?: string;
  account_id: string;
}

export interface PersonaVerificationResult {
  inquiryId: string;
  status: 'completed' | 'pending' | 'failed';
  verificationLevel: string;
  attributes: {
    nameFirst?: string;
    nameLast?: string;
    addressStreet1?: string;
    addressCity?: string;
    addressSubdivision?: string;
    addressPostalCode?: string;
    addressCountryCode?: string;
    birthdate?: string;
    phoneNumber?: string;
    emailAddress?: string;
  };
  checks: Array<{
    type: string;
    status: string;
    details?: Record<string, unknown>;
  }>;
}

export class PersonaKYCService {
  private config: PersonaConfig;
  private baseUrl: string;

  constructor(config: PersonaConfig) {
    this.config = config;
    this.baseUrl = config.environment === 'production'
      ? 'https://withpersona.com/api/v1'
      : 'https://sandbox-api.withpersona.com/api/v1';
  }

  /**
   * Create a new verification inquiry
   */
  async createInquiry(
    tenantId: TenantId,
    userId: UserId,
    referenceId: string,
    templateId?: string
  ): Promise<PersonaInquiry> {
    try {
      const response = await fetch(`${this.baseUrl}/inquiries`, {
        method: 'POST',
        headers: {
          'Persona-Version': '2023-01-05',
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: {
            type: 'inquiry',
            attributes: {
              reference_id: referenceId,
              template_id: templateId || 'tmpl_default',
              metadata: {
                tenant_id: tenantId,
                user_id: userId,
              },
            },
          },
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Persona API error: ${error.errors?.[0]?.detail || 'Unknown error'}`);
      }

      const data = await response.json();
      const inquiry = data.data;

      logger.info('Persona inquiry created', {
        inquiryId: inquiry.id,
        tenantId,
        userId,
        referenceId,
      });

      return {
        id: inquiry.id,
        status: inquiry.attributes.status,
        reference_id: inquiry.attributes.reference_id,
        created_at: inquiry.attributes.created_at,
        account_id: inquiry.attributes.account_id,
      };
    } catch (error) {
      logger.error('Failed to create Persona inquiry', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Get inquiry status
   */
  async getInquiry(inquiryId: string): Promise<PersonaVerificationResult> {
    try {
      const response = await fetch(`${this.baseUrl}/inquiries/${inquiryId}`, {
        headers: {
          'Persona-Version': '2023-01-05',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Persona API error: ${error.errors?.[0]?.detail || 'Unknown error'}`);
      }

      const data = await response.json();
      const inquiry = data.data;
      const attributes = inquiry.attributes;

      return {
        inquiryId: inquiry.id,
        status: attributes.status === 'completed' ? 'completed' : attributes.status === 'failed' ? 'failed' : 'pending',
        verificationLevel: attributes.verification_level || 'standard',
        attributes: {
          nameFirst: attributes.name_first,
          nameLast: attributes.name_last,
          addressStreet1: attributes.address_street_1,
          addressCity: attributes.address_city,
          addressSubdivision: attributes.address_subdivision,
          addressPostalCode: attributes.address_postal_code,
          addressCountryCode: attributes.address_country_code,
          birthdate: attributes.birthdate,
          phoneNumber: attributes.phone_number,
          emailAddress: attributes.email_address,
        },
        checks: (attributes.checks || []).map((check: any) => ({
          type: check.type,
          status: check.status,
          details: check.details,
        })),
      };
    } catch (error) {
      logger.error('Failed to get Persona inquiry', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Handle webhook from Persona
   */
  async handleWebhook(
    webhookData: {
      data: {
        type: string;
        id: string;
        attributes: {
          status: string;
          [key: string]: unknown;
        };
      };
    },
    signature: string
  ): Promise<void> {
    // Verify webhook signature in production
    if (this.config.webhookSecret) {
      // Signature verification logic here
    }

    const inquiry = webhookData.data;
    logger.info('Persona webhook received', {
      inquiryId: inquiry.id,
      status: inquiry.attributes.status,
    });

    // Handle different statuses
    switch (inquiry.attributes.status) {
      case 'completed':
        logger.info('Persona verification completed', { inquiryId: inquiry.id });
        // Trigger downstream processing
        break;

      case 'failed':
        logger.warn('Persona verification failed', { inquiryId: inquiry.id });
        // Handle failure
        break;

      default:
        logger.info('Persona verification status update', {
          inquiryId: inquiry.id,
          status: inquiry.attributes.status,
        });
    }
  }
}

export function createPersonaService(config: PersonaConfig): PersonaKYCService {
  return new PersonaKYCService(config);
}
