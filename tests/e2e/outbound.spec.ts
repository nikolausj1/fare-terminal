import { test, expect } from '@playwright/test';

// PRD §34.3 flow 6: outbound booking control. In demo mode (DATA_PROVIDER
// unset/"demo"), no offer carries an outbound URL, so MarketHeader renders
// the disabled "Not available in demo" state instead of a real external
// link — this test accepts either shape, since a real-provider deployment
// would show the external link + disclaimer instead.
test('outbound control exists as an external link or a demo-disabled state', async ({ page }) => {
  await page.goto('/market/jfk/lhr');

  const outboundLink = page.getByRole('link', { name: /Check current availability/i });
  const disabledButton = page.getByRole('button', { name: /Check current availability/i });

  const hasLink = await outboundLink.isVisible().catch(() => false);

  if (hasLink) {
    await expect(outboundLink).toHaveAttribute('target', '_blank');
    await expect(outboundLink).toHaveAttribute('rel', /noopener/);
    await expect(page.getByText(/External site/i)).toBeVisible();
  } else {
    await expect(disabledButton).toBeVisible();
    await expect(disabledButton).toBeDisabled();
    await expect(page.getByText(/Not available in demo/i).first()).toBeVisible();
  }
});
