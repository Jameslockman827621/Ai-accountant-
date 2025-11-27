import axios, { AxiosInstance } from 'axios';

export type HMRCEnvironment = 'sandbox' | 'production';

const SANDBOX_BASE_URL = 'https://test-api.service.hmrc.gov.uk';
const PRODUCTION_BASE_URL = 'https://api.service.hmrc.gov.uk';

export interface HMRCClientConfig {
  env?: HMRCEnvironment;
  baseUrl?: string;
  accessToken?: string;
}

export interface VATReturnPayload {
  periodKey: string;
  vatDueSales: number;
  vatDueAcquisitions: number;
  totalVatDue: number;
  vatReclaimedCurrPeriod: number;
  netVatDue: number;
  totalValueSalesExVAT: number;
  totalValuePurchasesExVAT: number;
  totalValueGoodsSuppliedExVAT: number;
  totalAcquisitionsExVAT: number;
}

export interface HMRCSubmissionResponse {
  processingDate: string;
  paymentIndicator?: string;
  documentReference?: string;
  formBundleNumber?: string;
  receiptId?: string;
}

export interface VATObligation {
  periodKey: string;
  start: string;
  end: string;
  due: string;
  status: string;
}

export interface CodeExchangeParams {
  clientId: string;
  clientSecret: string;
  authorizationCode: string;
  redirectUri: string;
  env?: HMRCEnvironment;
  baseUrl?: string;
  scope?: string;
}

export interface TokenRefreshParams {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  env?: HMRCEnvironment;
  baseUrl?: string;
  scope?: string;
}

export interface HMRCAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshTokenExpiresIn?: number;
  scope?: string;
  tokenType: string;
}

export interface HMRCRulePack {
  id: string;
  name: string;
  jurisdiction: 'UK';
  description: string;
  workflows: Array<{
    filingType: 'VAT' | 'PAYE';
    submissionPath: string;
    evidenceRequired: string[];
    defaultCurrency: 'GBP';
  }>;
  regulators: string[];
}

export const HMRC_VAT_RULE_PACK: HMRCRulePack = {
  id: 'rulepack-uk',
  name: 'HMRC VAT & PAYE',
  jurisdiction: 'UK',
  description: 'Ready-to-use MTD compliant VAT and PAYE flows with audit artifacts.',
  regulators: ['HMRC'],
  workflows: [
    {
      filingType: 'VAT',
      submissionPath: '/organisations/vat/{vrn}/returns',
      evidenceRequired: ['Digital links audit file', 'VAT calculation workpapers'],
      defaultCurrency: 'GBP',
    },
    {
      filingType: 'PAYE',
      submissionPath: '/paye/submissions',
      evidenceRequired: ['RTI submissions log', 'FPS/EPS confirmations'],
      defaultCurrency: 'GBP',
    },
  ],
};

function resolveBaseUrl(env?: HMRCEnvironment, baseUrl?: string): string {
  if (baseUrl) {
    return baseUrl;
  }
  return env === 'production' ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL;
}

function normaliseAxiosError(error: unknown): Error {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const data = error.response?.data;
    return new Error(
      `HMRC API error${status ? ` (${status})` : ''}${
        data ? `: ${JSON.stringify(data)}` : ''
      }`
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

function toPence(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error('VAT payload contains invalid number');
  }
  return Math.round(value * 100);
}

export class HMRCClient {
  private readonly client: AxiosInstance;
  private accessToken: string | undefined;

  constructor(config: HMRCClientConfig = {}) {
    this.client = axios.create({
      baseURL: resolveBaseUrl(config.env, config.baseUrl),
      headers: {
        Accept: 'application/vnd.hmrc.1.0+json',
        'Content-Type': 'application/json',
      },
    });
    this.accessToken = config.accessToken;
  }

  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  private requireToken(): string {
    if (!this.accessToken) {
      throw new Error('HMRC access token not provided');
    }
    return this.accessToken;
  }

  async submitVatReturn(
    vrn: string,
    payload: VATReturnPayload
  ): Promise<HMRCSubmissionResponse> {
    try {
      const response = await this.client.post(
        `/organisations/vat/${vrn}/returns`,
        {
          periodKey: payload.periodKey,
          vatDueSales: toPence(payload.vatDueSales),
          vatDueAcquisitions: toPence(payload.vatDueAcquisitions),
          totalVatDue: toPence(payload.totalVatDue),
          vatReclaimedCurrPeriod: toPence(payload.vatReclaimedCurrPeriod),
          netVatDue: toPence(payload.netVatDue),
          totalValueSalesExVAT: toPence(payload.totalValueSalesExVAT),
          totalValuePurchasesExVAT: toPence(payload.totalValuePurchasesExVAT),
          totalValueGoodsSuppliedExVAT: toPence(
            payload.totalValueGoodsSuppliedExVAT
          ),
          totalAcquisitionsExVAT: toPence(payload.totalAcquisitionsExVAT),
        },
        {
          headers: {
            Authorization: `Bearer ${this.requireToken()}`,
          },
        }
      );

      return {
        processingDate:
          response.data.processingDate || new Date().toISOString(),
        paymentIndicator: response.data.paymentIndicator,
        documentReference: response.data.documentReference,
        formBundleNumber: response.data.formBundleNumber,
        receiptId: response.data.receiptId,
      };
    } catch (error) {
      throw normaliseAxiosError(error);
    }
  }

  async getVatObligations(
    vrn: string,
    params?: { status?: string; from?: string; to?: string }
  ): Promise<VATObligation[]> {
    try {
      const response = await this.client.get(
        `/organisations/vat/${vrn}/obligations`,
        {
          params,
          headers: {
            Authorization: `Bearer ${this.requireToken()}`,
          },
        }
      );
      return response.data.obligations ?? [];
    } catch (error) {
      throw normaliseAxiosError(error);
    }
  }
}

async function executeTokenRequest(
  baseUrl: string,
  body: Record<string, string>
): Promise<HMRCAuthTokens> {
  try {
    const response = await axios.post(
      `${baseUrl}/oauth/token`,
      new URLSearchParams(body),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      expiresIn: response.data.expires_in || 3600,
      refreshTokenExpiresIn: response.data.refresh_token_expires_in,
      scope: response.data.scope,
      tokenType: response.data.token_type,
    };
  } catch (error) {
    throw normaliseAxiosError(error);
  }
}

export async function exchangeAuthorizationCode(
  params: CodeExchangeParams
): Promise<HMRCAuthTokens> {
  return executeTokenRequest(resolveBaseUrl(params.env, params.baseUrl), {
    grant_type: 'authorization_code',
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code: params.authorizationCode,
    redirect_uri: params.redirectUri,
    scope: params.scope ?? '',
  });
}

export async function refreshAccessToken(
  params: TokenRefreshParams
): Promise<HMRCAuthTokens> {
  return executeTokenRequest(resolveBaseUrl(params.env, params.baseUrl), {
    grant_type: 'refresh_token',
    client_id: params.clientId,
    client_secret: params.clientSecret,
    refresh_token: params.refreshToken,
    scope: params.scope ?? '',
  });
}
