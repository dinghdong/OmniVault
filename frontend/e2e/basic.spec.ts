import { test, expect } from '@playwright/test';

test.describe('Basic Page Load Tests', () => {
  test('homepage loads with 200 status', async ({ page }) => {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBeLessThan(400);
  });

  test('dashboard page loads with 200 status', async ({ page }) => {
    const response = await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBeLessThan(400);
  });

  test('apply page loads with 200 status', async ({ page }) => {
    const response = await page.goto('/apply', { waitUntil: 'domcontentloaded' });
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
});

test.describe('Dashboard Page Content', () => {
  test('should contain Fund Dashboard text', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'networkidle' });
    const content = await page.content();
    expect(content).toContain('Fund Dashboard');
  });
});

test.describe('Apply Page Content', () => {
  test('should contain Apply text', async ({ page }) => {
    await page.goto('/apply', { waitUntil: 'networkidle' });
    const content = await page.content();
    expect(content).toContain('Apply');
  });

  test('should show three steps', async ({ page }) => {
    await page.goto('/apply', { waitUntil: 'networkidle' });
    await expect(page.locator('text=Project Info')).toBeVisible();
    await expect(page.locator('text=Code & Docs')).toBeVisible();
    await expect(page.locator('text=Submit')).toBeVisible();
  });
});