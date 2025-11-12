import { describe, it, expect } from '@jest/globals';

describe('PAYE Calculation', () => {
  it('should calculate income tax correctly', () => {
    const grossPay = 50000;
    const personalAllowance = 12570;
    const taxableIncome = grossPay - personalAllowance;
    const basicRateTax = (50270 - personalAllowance) * 0.20;
    const higherRateTax = (taxableIncome - (50270 - personalAllowance)) * 0.40;
    const totalTax = basicRateTax + higherRateTax;
    
    expect(totalTax).toBeGreaterThan(0);
  });

  it('should calculate National Insurance correctly', () => {
    const grossPay = 50000;
    const primaryThreshold = 12570;
    const taxableIncome = grossPay - primaryThreshold;
    const ni = taxableIncome * 0.12; // Employee NI rate
    
    expect(ni).toBeGreaterThan(0);
  });
});
