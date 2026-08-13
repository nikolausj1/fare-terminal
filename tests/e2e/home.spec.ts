import { test, expect } from '@playwright/test';

// PRD §34.3 flow 1: Market Pulse loads in demo mode.
test.describe('home / market pulse', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('shows the demo banner', async ({ page }) => {
    await expect(page.getByText('Synthetic demo data. Not current airfare.')).toBeVisible();
  });

  // WP-P2: this deployment is now a personal fare terminal (home airport
  // SEA) and the "From Seattle" board is the FIRST content section on the
  // page, ahead of the network-wide Index hero / Top movers / Deals ticker
  // sections. Asserts both presence and relative DOM order (not just that
  // the section exists somewhere on the page).
  test('shows the "From Seattle" board before the Fare Terminal Index', async ({ page }) => {
    const board = page.getByRole('region', { name: 'From Seattle' });
    await expect(board).toBeVisible();
    await expect(board.getByText('SEA', { exact: true }).first()).toBeVisible();

    const boardBox = await board.boundingBox();
    const indexHeading = page.getByRole('heading', { name: 'Fare Terminal Index' });
    const indexBox = await indexHeading.boundingBox();
    expect(boardBox).not.toBeNull();
    expect(indexBox).not.toBeNull();
    expect(boardBox!.y).toBeLessThan(indexBox!.y);
  });

  // Honesty states (WP-P2): a destination with no cached fare seen yet is
  // rendered, not hidden — the demo data seeds SBA/STS in exactly that
  // state under the California group (see lib/markets/home-board.ts /
  // scripts/bootstrap-real.ts's demo seed).
  test('renders a "no cached fares seen yet" card for a watch-level destination with no price', async ({ page }) => {
    const board = page.getByRole('region', { name: 'From Seattle' });
    const emptyCards = board.getByText('No cached fares seen yet');
    // At least one such honesty-state card exists somewhere in the board on
    // demo data; exact count/identity is data-dependent so this only checks
    // the state is representable and actually renders, not a specific code.
    await expect(emptyCards.first()).toBeVisible();
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
