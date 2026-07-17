import { test, expect } from '@playwright/test';

// PRD §34.3 flow 2: autocomplete search -> market page.
test('typing "sea" autocompletes Seattle, picking SEA + FCO navigates to the market page', async ({ page }) => {
  await page.goto('/');

  const fromField = page.getByLabel('From', { exact: true });
  await fromField.click();
  await fromField.fill('sea');

  const seattleOption = page.getByRole('option', { name: /Seattle/i });
  await expect(seattleOption).toBeVisible();
  await expect(seattleOption).toContainText('SEA');
  await seattleOption.click();

  const toField = page.getByLabel('To', { exact: true });
  await toField.click();
  await toField.fill('fco');

  const romeOption = page.getByRole('option', { name: /Rome/i });
  await expect(romeOption).toBeVisible();
  await expect(romeOption).toContainText('FCO');
  await romeOption.click();

  await page.getByRole('button', { name: 'View market' }).click();

  await expect(page).toHaveURL(/\/market\/sea\/fco/);
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toContainText('SEA');
  await expect(heading).toContainText('FCO');
});
