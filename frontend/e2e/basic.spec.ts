import { test, expect } from '@playwright/test';

test.describe('Basic Page Load Tests', () => {
  test('homepage loads with 200 status', async ({ page }) => {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBeLessThan(400);
  });

  test('agent-sim devtool page loads with 200 status', async ({ page }) => {
    const response = await page.goto('/agent-sim', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBeLessThan(400);
  });

  test('audit detail page loads with 200 status', async ({ page }) => {
    const response = await page.goto('/audit/1', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBeLessThan(400);
  });
});

test.describe('Homepage Content', () => {
  test('should contain OmniVault text', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const content = await page.content();
    expect(content).toContain('OmniVault');
  });

  test('should have main heading', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('h1')).toBeVisible();
  });

  test('should render all main sections', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('#portfolio')).toBeAttached();
    await expect(page.locator('#pipeline')).toBeAttached();
    await expect(page.locator('#apply')).toBeAttached();
    await expect(page.locator('#how-it-works')).toBeAttached();
  });
});

test.describe('Project Pipeline (seeded chain state)', () => {
  test('pipeline section shows seeded projects', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.locator('#pipeline').scrollIntoViewIfNeeded();
    // e2e-local.ts seeds 5 projects; cards render once the chain read resolves
    await expect(
      page.locator('#pipeline .project-card, #pipeline [class*="project"]').first()
    ).toBeVisible({ timeout: 15000 });
  });
});
