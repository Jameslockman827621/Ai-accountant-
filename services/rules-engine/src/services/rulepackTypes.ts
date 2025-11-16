import {
  TaxRulepack,
  TaxRegressionCase,
} from '@ai-accountant/shared-types';

export interface InstallableTaxRulepack extends TaxRulepack {
  regressionTests?: TaxRegressionCase[];
}

export interface RulepackCalculationContext {
  taxableIncome?: number;
  deductions?: number;
  credits?: number;
}
