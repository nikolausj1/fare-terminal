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

  // WP-F3: "Biggest drops" (gated on a 5%+ 24h move, which on real data was
  // frequently empty — the audit's "no qualifying drops" finding) was
  // replaced by "Top movers (24h)", an always-ranked-by-|pct24h| list that
  // is never gated on move size (see lib/markets/movers.ts). Same assertion
  // intent — at least 3 cards, each a market-page link — against the new
  // section name.
  test('shows at least 3 top-mover cards, each linking to a market page', async ({ page }) => {
    const movers = page.getByRole('region', { name: 'Top movers (24h)' });
    await expect(movers).toBeVisible();
    const cards = movers.getByRole('link');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(3);

    for (let i = 0; i < count; i++) {
      await expect(cards.nth(i)).toHaveAttribute('href', /^\/market\/[a-z]{3}\/[a-z]{3}/);
    }
  });

  test('clicking a top-mover card lands on its market page', async ({ page }) => {
    const movers = page.getByRole('region', { name: 'Top movers (24h)' });
    const firstCard = movers.getByRole('link').first();
    const href = await firstCard.getAttribute('href');
    expect(href).toBeTruthy();

    await firstCard.click();
    await expect(page).toHaveURL(new RegExp(href!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
