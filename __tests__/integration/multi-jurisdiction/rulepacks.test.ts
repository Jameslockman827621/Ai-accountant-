import { listRulePacks, getRulePackById } from '@ai-accountant/multi-jurisdiction/services/rulePacks';
import { HMRC_VAT_RULE_PACK } from '@ai-accountant/hmrc';
import dataset from '../../golden-dataset/multiJurisdiction.json';

describe('multi-jurisdiction rule packs', () => {
  it('exposes EU/US/UK/AU/CA packs', () => {
    const jurisdictions = listRulePacks().map((p) => p.jurisdiction);
    expect(jurisdictions).toEqual(expect.arrayContaining(['EU', 'US', 'UK', 'AU', 'CA']));
  });

  it('aligns HMRC pack metadata', () => {
    const ukPack = getRulePackById('rulepack-uk');
    expect(ukPack?.regulators).toContain('HMRC');
    expect(HMRC_VAT_RULE_PACK.id).toBe('rulepack-uk');
    expect(HMRC_VAT_RULE_PACK.workflows.find((flow) => flow.filingType === 'VAT')).toBeDefined();
  });

  it('covers golden dataset scenarios', () => {
    const packs = listRulePacks();
    const scenarioPacks = dataset.scenarios.map((scenario) => scenario.rulePackId);
    scenarioPacks.forEach((packId) => {
      expect(packs.find((p) => p.id === packId)).toBeDefined();
    });
  });
});
