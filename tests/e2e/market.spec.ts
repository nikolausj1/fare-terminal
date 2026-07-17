import { test, expect } from '@playwright/test';

// PRD §34.3 flow 3: market page content — JFK-LHR is seeded with the
// SHARP_DROP_SURGE scenario (db/seed/markets.ts), so it always has a
// recommendation (not INSUFFICIENT_DATA) and a non-empty event timeline.
const MARKET_PATH = '/market/jfk/lhr';

test.describe('market page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(MARKET_PATH);
  });

  test('benchmark price renders in $ pattern', async ({ page }) => {
    const summary = page.getByRole('region', { name: 'Market summary' });
    await expect(summary).toBeVisible();
    await expect(summary.getByText(/^\$[\d,]+$/).first()).toBeVisible();
  });

  test('recommendation badge is present', async ({ page }) => {
    const recPanel = page.getByRole('region', { name: 'Recommendation' });
    await expect(recPanel).toBeVisible();
    await expect(
      recPanel.getByText(/^(Buy|Lean buy|Neutral|Wait|Insufficient data)$/).first()
    ).toBeVisible();
  });

  test('price history chart region is present', async ({ page }) => {
    await expect(page.getByRole('figure', { name: /Price history chart/i })).toBeVisible();
  });

  test('offer table has at least 5 rows, sorted ascending by price', async ({ page }) => {
    const table = page.getByTestId('offer-table-desktop');
    const rows = table.locator('tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(5);

    // Price is the 2nd column (after Airline); default sort is price asc.
    const prices: number[] = [];
    for (let i = 0; i < count; i++) {
      const text = await rows.nth(i).locator('td').nth(1).innerText();
      prices.push(Number(text.replace(/[^0-9.]/g, '')));
    }
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]).toBeGreaterThanOrEqual(prices[i - 1]);
    }
  });

  test('"Why this recommendation?" discloses Observed and Inferred sections', async ({ page }) => {
    const recPanel = page.getByRole('region', { name: 'Recommendation' });
    const toggle = recPanel.getByRole('button', { name: 'Why this recommendation?' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await expect(recPanel.getByRole('heading', { name: 'Observed' })).toBeVisible();
    await expect(recPanel.getByRole('heading', { name: 'Inferred' })).toBeVisible();
  });

  test('event timeline shows events and the severity filter toggle never errors', async ({ page }) => {
    const timeline = page.getByRole('region', { name: 'Event timeline' });
    await expect(timeline).toBeVisible();

    const items = timeline.locator('ol > li');
    const initialCount = await items.count();
    expect(initialCount).toBeGreaterThan(0);

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));

    const minorToggle = timeline.getByRole('button', { name: 'Show minor events' });
    await minorToggle.click();
    await expect(timeline.getByRole('button', { name: 'Hide minor events' })).toBeVisible();

    const afterCount = await items.count();
    expect(afterCount).toBeGreaterThanOrEqual(initialCount);
    expect(errors).toEqual([]);
  });
});
