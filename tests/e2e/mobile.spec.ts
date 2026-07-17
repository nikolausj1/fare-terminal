import { test, expect } from '@playwright/test';

// PRD §34.3 flow 8: mobile viewport (390px). MarketHeader renders a sticky
// compact summary and OfferTable renders a card list instead of the wide
// table at this width (components/market/MarketHeader.tsx,
// components/market/OfferTable.tsx) — both are tagged with data-testid
// since their accessible content duplicates the desktop layout's (same
// origin/destination text, same offer fields), leaving no role/name that
// distinguishes "the mobile one" from "the desktop one".
test.use({ viewport: { width: 390, height: 844 } });

test('market page renders the mobile layout with no horizontal page scroll', async ({ page }) => {
  await page.goto('/market/jfk/lhr');

  await expect(page.getByTestId('sticky-summary')).toBeVisible();
  await expect(page.getByTestId('offer-table-mobile')).toBeVisible();
  await expect(page.getByTestId('offer-table-desktop')).not.toBeVisible();

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.scrollingElement!.scrollWidth,
    clientWidth: document.scrollingElement!.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
});
