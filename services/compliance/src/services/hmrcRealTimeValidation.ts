import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { getHMRCAccessToken } from '@ai-accountant/integrations-service/services/hmrc';
import axios from 'axios';

const logger = createLogger('compliance-service');

const HMRC_BASE_URL = process.env.HMRC_BASE_URL || 'https://api.service.hmrc.gov.uk';

export interface HMRCValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  hmrcData: Record<string, unknown> | null;
}

/**
 * Validate VAT number with HMRC in real-time
 */
export async function validateVATNumberRealTime(
  tenantId: TenantId,
  vatNumber: string
): Promise<HMRCValidationResult> {
  try {
    const accessToken = await getHMRCAccessToken(tenantId);

    const response = await axios.get(
      `${HMRC_BASE_URL}/organisations/vat/check-vat-number/${vatNumber}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.hmrc.1.0+json',
        },
      }
    );

    return {
      isValid: response.data.valid === true,
      errors: response.data.valid === false ? ['Invalid VAT number'] : [],
      warnings: [],
      hmrcData: response.data,
    };
  } catch (error) {
    logger.error('HMRC VAT validation failed', error);
    return {
      isValid: false,
      errors: ['Failed to validate with HMRC'],
      warnings: [],
      hmrcData: null,
    };
  }
}

/**
 * Validate PAYE tax code with HMRC
 */
export async function validatePAYETaxCode(
  tenantId: TenantId,
  taxCode: string,
  employeeId: string
): Promise<HMRCValidationResult> {
  try {
    const accessToken = await getHMRCAccessToken(tenantId);

    // HMRC PAYE validation endpoint
    const response = await axios.get(
      `${HMRC_BASE_URL}/individuals/tax-codes/${taxCode}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.hmrc.1.0+json',
        },
      }
    );

    return {
      isValid: response.data.valid === true,
      errors: response.data.valid === false ? ['Invalid tax code'] : [],
      warnings: response.data.warnings || [],
      hmrcData: response.data,
    };
  } catch (error) {
    logger.error('HMRC tax code validation failed', {
      error,
      tenantId,
      employeeId,
      taxCode,
    });
    return {
      isValid: false,
      errors: ['Failed to validate tax code with HMRC'],
      warnings: [],
      hmrcData: null,
    };
  }
}

/**
 * Validate Corporation Tax calculation before submission
 */
export async function validateCorporationTaxSubmission(
  tenantId: TenantId,
  ct600Data: Record<string, unknown>
): Promise<HMRCValidationResult> {
  try {
    const accessToken = await getHMRCAccessToken(tenantId);

    // Pre-submission validation
    const response = await axios.post(
      `${HMRC_BASE_URL}/corporation-tax/returns/validate`,
      ct600Data,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.hmrc.1.0+json',
          'Content-Type': 'application/json',
        },
      }
    );

    const errors: string[] = [];
    const warnings: string[] = [];

    if (response.data.errors) {
      errors.push(...response.data.errors.map((e: { message: string }) => e.message));
    }

    if (response.data.warnings) {
      warnings.push(...response.data.warnings.map((w: { message: string }) => w.message));
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      hmrcData: response.data,
    };
  } catch (error) {
    logger.error('HMRC CT validation failed', error);
    return {
      isValid: false,
      errors: ['Failed to validate with HMRC'],
      warnings: [],
      hmrcData: null,
    };
  }
}
