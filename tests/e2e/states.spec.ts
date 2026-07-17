import { test, expect } from '@playwright/test';

// PRD §34.3 flow 5: special data states — insufficient data, stale data,
// and an unknown/untracked route. Markets picked from db/seed/markets.ts
// scenarios: BOS-DUB is SHORT_HISTORY (insufficient data gate),
// ATL-LIS is STALE_OUTAGE (freshness warning).

test('BOS-DUB shows Insufficient data with no buy/wait advice and an explanation', async ({ page }) => {
  await page.goto('/market/bos/dub');

  const recPanel = page.getByRole('region', { name: 'Recommendation' });
  await expect(recPanel.getByText('Insufficient data')).toBeVisible();

  // No buy/wait/lean-buy/neutral badge alongside it.
  await expect(recPanel.getByText(/^(Buy|Lean buy|Neutral|Wait)$/)).toHaveCount(0);

  await expect(recPanel.getByText('Why no recommendation')).toBeVisible();
});

test('ATL-LIS shows a stale-data warning', async ({ page }) => {
  await page.goto('/market/atl/lis');

  await expect(page.getByText(/data may be stale/i)).toBeVisible();
});

test('an unknown market returns the not-found experience with a search box', async ({ page }) => {
  await page.goto('/market/xxx/yyy');

  await expect(page.getByRole('heading', { name: 'Market not tracked' })).toBeVisible();
  await expect(page.getByLabel('From', { exact: true })).toBeVisible();
  await expect(page.getByLabel('To', { exact: true })).toBeVisible();
});
