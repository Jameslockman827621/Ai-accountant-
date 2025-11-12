import { getTaxRulepack, applyTaxRules } from '../services/taxRules';

describe('Rules Engine Service', () => {
  describe('getTaxRulepack', () => {
    it('should return UK tax rulepack', async () => {
      const rulepack = await getTaxRulepack('GB');
      expect(rulepack).not.toBeNull();
      expect(rulepack?.country).toBe('GB');
      expect(rulepack?.rules.length).toBeGreaterThan(0);
    });

    it('should return null for unsupported country', async () => {
      const rulepack = await getTaxRulepack('XX');
      expect(rulepack).toBeNull();
    });
  });

  describe('applyTaxRules', () => {
    it('should apply standard VAT rate for standard category', async () => {
      const result = await applyTaxRules('GB', {
        amount: 100,
        category: 'standard',
      });

      expect(result.taxRate).toBe(0.20);
      expect(result.taxAmount).toBe(20);
      expect(result.ruleId).toBe('uk-vat-standard-rate');
    });

    it('should apply reduced VAT rate for reduced category', async () => {
      const result = await applyTaxRules('GB', {
        amount: 100,
        category: 'reduced',
      });

      expect(result.taxRate).toBe(0.05);
      expect(result.taxAmount).toBe(5);
      expect(result.ruleId).toBe('uk-vat-reduced-rate');
    });

    it('should apply zero VAT rate for zero category', async () => {
      const result = await applyTaxRules('GB', {
        amount: 100,
        category: 'zero',
      });

      expect(result.taxRate).toBe(0.00);
      expect(result.taxAmount).toBe(0);
      expect(result.ruleId).toBe('uk-vat-zero-rate');
    });
  });
});
