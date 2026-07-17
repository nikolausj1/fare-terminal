import { test, expect } from '@playwright/test';

// PRD §34.3 flow 1: Market Pulse loads in demo mode.
test.describe('home / market pulse', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('shows the demo banner', async ({ page }) => {
    await expect(page.getByText('Synthetic demo data. Not current airfare.')).toBeVisible();
  });

  test('shows non-empty AI market brief text', async ({ page }) => {
    const brief = page.getByRole('region', { name: 'AI market brief' });
    await expect(brief).toBeVisible();
    const text = await brief.locator('p').first().innerText();
    expect(text.trim().length).toBeGreaterThan(0);
  });

  test('shows at least 3 drop cards, each linking to a market page', async ({ page }) => {
    const drops = page.getByRole('region', { name: 'Biggest drops' });
    await expect(drops).toBeVisible();
    const cards = drops.getByRole('link');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(3);

    for (let i = 0; i < count; i++) {
      await expect(cards.nth(i)).toHaveAttribute('href', /^\/market\/[a-z]{3}\/[a-z]{3}/);
    }
  });

  test('clicking a drop card lands on its market page', async ({ page }) => {
    const drops = page.getByRole('region', { name: 'Biggest drops' });
    const firstCard = drops.getByRole('link').first();
    const href = await firstCard.getAttribute('href');
    expect(href).toBeTruthy();

    await firstCard.click();
    await expect(page).toHaveURL(new RegExp(href!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
