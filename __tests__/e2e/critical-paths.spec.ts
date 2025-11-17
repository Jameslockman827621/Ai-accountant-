/**
 * Playwright E2E Tests for Critical Paths
 * Tests onboarding, upload, reconciliation, filing approval, and assistant
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

test.describe('Critical User Paths', () => {
  test.beforeEach(async ({ page }) => {
    // Login (assuming auth is set up)
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'testpassword');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');
  });

  test('onboarding flow', async ({ page }) => {
    await page.goto(`${BASE_URL}/onboarding`);
    
    // Fill onboarding form
    await page.fill('input[name="companyName"]', 'Test Company');
    await page.selectOption('select[name="country"]', 'GB');
    await page.fill('input[name="vatNumber"]', 'GB123456789');
    await page.click('button[type="submit"]');
    
    // Verify completion
    await expect(page.locator('text=Onboarding Complete')).toBeVisible();
  });

  test('document upload and processing', async ({ page }) => {
    await page.goto(`${BASE_URL}/documents`);
    
    // Upload document
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles('__tests__/fixtures/sample-invoice.pdf');
    
    // Wait for processing
    await expect(page.locator('text=Processing')).toBeVisible();
    await expect(page.locator('text=Extracted')).toBeVisible({ timeout: 30000 });
    
    // Verify extraction
    await expect(page.locator('text=Invoice Number')).toBeVisible();
  });

  test('reconciliation workflow', async ({ page }) => {
    await page.goto(`${BASE_URL}/reconciliation`);
    
    // Select account
    await page.selectOption('select[name="account"]', '1000');
    await page.click('button:has-text("Reconcile")');
    
    // Wait for reconciliation
    await expect(page.locator('text=Reconciliation Complete')).toBeVisible({ timeout: 30000 });
    
    // Verify matched transactions
    await expect(page.locator('text=Matched')).toBeVisible();
  });

  test('filing preparation and approval', async ({ page }) => {
    await page.goto(`${BASE_URL}/filings`);
    
    // Create filing
    await page.click('button:has-text("Create VAT Return")');
    await page.selectOption('select[name="period"]', 'Q1-2024');
    await page.click('button:has-text("Generate")');
    
    // Wait for generation
    await expect(page.locator('text=Draft Created')).toBeVisible({ timeout: 30000 });
    
    // Review and approve
    await page.click('button:has-text("Review")');
    await page.fill('textarea[name="reviewerComment"]', 'Approved for submission');
    await page.click('button:has-text("Approve")');
    
    // Verify approval
    await expect(page.locator('text=Approved')).toBeVisible();
  });

  test('assistant query and action', async ({ page }) => {
    await page.goto(`${BASE_URL}/assistant`);
    
    // Ask question
    await page.fill('input[placeholder*="question"]', 'What is our VAT liability?');
    await page.click('button:has-text("Send")');
    
    // Wait for response
    await expect(page.locator('text=VAT')).toBeVisible({ timeout: 10000 });
    
    // Verify citations
    await expect(page.locator('text=\\[1\\]')).toBeVisible();
    
    // If action requires approval, test approval flow
    const approvalButton = page.locator('button:has-text("Approve")');
    if (await approvalButton.isVisible()) {
      await approvalButton.click();
      await expect(page.locator('text=Approved')).toBeVisible();
    }
  });
});
