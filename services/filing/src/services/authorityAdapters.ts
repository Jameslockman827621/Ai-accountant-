import { TenantId } from '@ai-accountant/shared-types';
import { createLogger } from '@ai-accountant/shared-utils';
import { hmrcAdapter } from './adapters/hmrcAdapter';
import { craAdapter } from './adapters/craAdapter';

const logger = createLogger('authority-adapters');

export interface SubmissionContext {
  filingId: string;
  tenantId: TenantId;
  filingType: string;
  jurisdiction: string;
  payload: Record<string, unknown>;
  adapterHint?: string;
}

export interface SubmissionResult {
  adapterId: string;
  authority: string;
  submissionReference: string;
  processingDate?: string;
  requiresPayment?: boolean;
  amountDue?: number;
  currency?: string;
}

interface AuthorityAdapter {
  id: string;
  supports(context: SubmissionContext): boolean;
  submit(context: SubmissionContext): Promise<SubmissionResult>;
}

class AuthorityAdapterRegistry {
  private adapters: AuthorityAdapter[] = [];

  register(adapter: AuthorityAdapter): void {
    this.adapters.push(adapter);
  }

  findSupportingAdapter(context: SubmissionContext): AuthorityAdapter | undefined {
    return (
      this.adapters.find(
        candidate =>
          (context.adapterHint && candidate.id === context.adapterHint && candidate.supports(context)) ||
          (!context.adapterHint && candidate.supports(context))
      ) || this.adapters.find(candidate => candidate.supports(context))
    );
  }

  async submit(context: SubmissionContext): Promise<SubmissionResult> {
    const adapter = this.findSupportingAdapter(context);

    if (!adapter) {
      throw new Error(`No adapter available for ${context.filingType} (${context.jurisdiction})`);
    }

    logger.info('Submitting filing via adapter', { adapter: adapter.id, filingId: context.filingId });
    return adapter.submit(context);
  }
}

class HMRCVATAuthorityAdapter implements AuthorityAdapter {
  id = 'hmrc_vat';

  supports(context: SubmissionContext): boolean {
    return context.filingType?.toLowerCase() === 'vat' && context.jurisdiction === 'GB';
  }

  async submit(context: SubmissionContext): Promise<SubmissionResult> {
    const reference = await hmrcAdapter.submitVATReturn(
      context.tenantId,
      String(context.payload['periodKey'] ?? context.payload['period_key'] ?? 'AA01'),
      {
        vatDueSales: Number(context.payload['vatDueSales'] ?? context.payload['vat_due_sales'] ?? 0),
        vatDueAcquisitions: Number(
          context.payload['vatDueAcquisitions'] ?? context.payload['vat_due_acquisitions'] ?? 0
        ),
        totalVatDue: Number(context.payload['totalVatDue'] ?? context.payload['total_vat_due'] ?? 0),
        vatReclaimedCurrPeriod: Number(
          context.payload['vatReclaimedCurrPeriod'] ?? context.payload['vat_reclaimed_curr_period'] ?? 0
        ),
        netVatDue: Number(context.payload['netVatDue'] ?? context.payload['net_vat_due'] ?? 0),
        totalValueSalesExVAT: Number(
          context.payload['totalValueSalesExVAT'] ?? context.payload['total_value_sales_ex_vat'] ?? 0
        ),
        totalValuePurchasesExVAT: Number(
          context.payload['totalValuePurchasesExVAT'] ?? context.payload['total_value_purchases_ex_vat'] ?? 0
        ),
        totalValueGoodsSuppliedExVAT: Number(
          context.payload['totalValueGoodsSuppliedExVAT'] ??
            context.payload['total_value_goods_supplied_ex_vat'] ??
            0
        ),
        totalAcquisitionsExVAT: Number(
          context.payload['totalAcquisitionsExVAT'] ?? context.payload['total_acquisitions_ex_vat'] ?? 0
        ),
      }
    );

    return {
      adapterId: this.id,
      authority: 'HMRC',
      submissionReference: reference,
      requiresPayment: Number(context.payload['netVatDue'] ?? 0) > 0,
      amountDue: Number(context.payload['netVatDue'] ?? 0),
      currency: 'GBP',
    };
  }
}

class HMRCPayeAdapter implements AuthorityAdapter {
  id = 'hmrc_paye';

  supports(context: SubmissionContext): boolean {
    return context.filingType?.toLowerCase() === 'paye' && context.jurisdiction === 'GB';
  }

  async submit(context: SubmissionContext): Promise<SubmissionResult> {
    const reference = `PAYE-${Date.now()}`;
    return {
      adapterId: this.id,
      authority: 'HMRC',
      submissionReference: reference,
      requiresPayment: true,
      amountDue: Number(context.payload['totalPAYE'] ?? 0),
      currency: 'GBP',
    };
  }
}

class HMRCCTAdapter implements AuthorityAdapter {
  id = 'hmrc_corporation_tax';

  supports(context: SubmissionContext): boolean {
    return context.filingType?.toLowerCase() === 'corporation_tax' && context.jurisdiction === 'GB';
  }

  async submit(context: SubmissionContext): Promise<SubmissionResult> {
    const reference = `CT-${Date.now()}`;
    return {
      adapterId: this.id,
      authority: 'HMRC',
      submissionReference: reference,
      requiresPayment: true,
      amountDue: Number(context.payload['corporationTax'] ?? 0),
      currency: 'GBP',
    };
  }
}

class CRAAdapterWrapper implements AuthorityAdapter {
  id = 'cra_gst';

  supports(context: SubmissionContext): boolean {
    return context.jurisdiction === 'CA';
  }

  async submit(context: SubmissionContext): Promise<SubmissionResult> {
    const reference = await craAdapter.submitGSTReturn(context.tenantId, {
      period: String(context.payload['period'] ?? '2024-Q1'),
      province: String(context.payload['province'] ?? 'ON'),
      salesAmount: Number(context.payload['totalSales'] ?? 0),
      gstAmount: Number(context.payload['gstDue'] ?? 0),
      hstAmount: Number(context.payload['hstDue'] ?? 0),
      qstAmount: Number(context.payload['qstDue'] ?? 0),
      inputTaxCredits: Number(context.payload['inputTaxCredits'] ?? 0),
      netTaxOwing: Number(context.payload['netTaxOwing'] ?? 0),
    });

    return {
      adapterId: this.id,
      authority: 'CRA',
      submissionReference: reference,
      requiresPayment: Number(context.payload['netTaxOwing'] ?? 0) > 0,
      amountDue: Number(context.payload['netTaxOwing'] ?? 0),
      currency: context.payload['currency'] ? String(context.payload['currency']) : 'CAD',
    };
  }
}

class IRSMeFAdapter implements AuthorityAdapter {
  id = 'irs_mef';

  supports(context: SubmissionContext): boolean {
    return context.jurisdiction.startsWith('US');
  }

  async submit(context: SubmissionContext): Promise<SubmissionResult> {
    const reference = `MEF-${Date.now()}`;
    return {
      adapterId: this.id,
      authority: 'IRS',
      submissionReference: reference,
      requiresPayment: Number(context.payload['taxLiability'] ?? 0) > 0,
      amountDue: Number(context.payload['taxLiability'] ?? 0),
      currency: 'USD',
    };
  }
}

class StateSalesTaxAdapter implements AuthorityAdapter {
  id = 'state_sales_tax';

  supports(context: SubmissionContext): boolean {
    return context.filingType?.toLowerCase() === 'sales_tax';
  }

  async submit(context: SubmissionContext): Promise<SubmissionResult> {
    const reference = `${context.jurisdiction}-SALESTAX-${Date.now()}`;
    return {
      adapterId: this.id,
      authority: `State-${context.jurisdiction}`,
      submissionReference: reference,
      requiresPayment: Number(context.payload['netTax'] ?? 0) > 0,
      amountDue: Number(context.payload['netTax'] ?? 0),
      currency: 'USD',
    };
  }
}

export const authorityAdapterRegistry = new AuthorityAdapterRegistry();
authorityAdapterRegistry.register(new HMRCVATAuthorityAdapter());
authorityAdapterRegistry.register(new HMRCPayeAdapter());
authorityAdapterRegistry.register(new HMRCCTAdapter());
authorityAdapterRegistry.register(new CRAAdapterWrapper());
authorityAdapterRegistry.register(new IRSMeFAdapter());
authorityAdapterRegistry.register(new StateSalesTaxAdapter());
