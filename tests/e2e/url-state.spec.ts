import { test, expect } from '@playwright/test';

// PRD §34.3 flow 4: URL state (exact mode + dates) round-trips through
// navigation/reload, and the Share button confirms a copy action. SEA-FCO
// is seeded with `includeExactDefinition: true` (db/seed/markets.ts), so an
// EXACT search_definition always exists for it.

function daysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const depart = daysFromNow(60);
const returnDate = daysFromNow(68);
const url = `/market/sea/fco?mode=exact&depart=${depart}&return=${returnDate}`;

test('exact-mode URL state persists across reload', async ({ page }) => {
  await page.goto(url);

  const exactToggle = page.getByRole('button', { name: 'Exact dates' });
  await expect(exactToggle).toHaveAttribute('aria-pressed', 'true');

  await page.reload();

  await expect(page).toHaveURL(new RegExp(`mode=exact&depart=${depart}&return=${returnDate}`));
  await expect(page.getByRole('button', { name: 'Exact dates' })).toHaveAttribute('aria-pressed', 'true');
});

test('Share button opens a popover; Copy link copies the canonical URL or shows a Copied confirmation', async ({
  page,
  context,
  browserName,
}) => {
  await page.goto(url);

  if (browserName === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  }

  // WP-F5: ShareButton is now a menu-button popover (Copy link / Copy
  // markdown / Download card / Embed data) rather than a single click-to-
  // copy button — the trigger always reads "Share"; "Copy link" is the item
  // that preserves the original copy-URL behavior.
  const shareTrigger = page.getByRole('button', { name: 'Share' });
  await shareTrigger.click();
  await expect(page.getByRole('menu', { name: 'Share this market' })).toBeVisible();

  const copyLinkItem = page.getByRole('menuitem', { name: /^(Copy link|Copied)$/ });
  await copyLinkItem.click();

  // Either the menu item flips to its "Copied" confirmation state, or the
  // canonical URL actually landed on the clipboard — accept whichever the
  // environment supports rather than coupling the test to one mechanism.
  try {
    await expect(page.getByRole('menuitem', { name: 'Copied' })).toBeVisible({ timeout: 3000 });
  } catch {
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
    expect(clipboardText).toContain('/market/sea/fco');
  }
});
