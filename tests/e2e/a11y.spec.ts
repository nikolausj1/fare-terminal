import { test, expect, type Page } from '@playwright/test';

// Part 2.4 — dependency-free a11y pass: exactly one <h1>, every <svg>/<img>
// is either aria-hidden (decorative) or has an accessible name, and every
// <button> has an accessible name. No axe — just DOM/ARIA checks that cover
// the concrete patterns this app uses (see components/ui/Badge.tsx,
// components/search/SearchBox.tsx's swap button, components/ui/Disclosure.tsx).

const PAGES: { name: string; path: string }[] = [
  { name: 'home', path: '/' },
  { name: 'market', path: '/market/jfk/lhr' },
  { name: 'methodology', path: '/methodology' },
];

async function accessibilityAudit(page: Page) {
  return page.evaluate(() => {
    function isAriaHidden(el: Element): boolean {
      let node: Element | null = el;
      while (node) {
        if (node.getAttribute('aria-hidden') === 'true') return true;
        node = node.parentElement;
      }
      return false;
    }

    function accessibleName(el: Element): string {
      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const text = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
          .join(' ')
          .trim();
        if (text) return text;
      }

      const titleEl = el.querySelector(':scope > title');
      if (titleEl?.textContent?.trim()) return titleEl.textContent.trim();

      const title = el.getAttribute('title');
      if (title && title.trim()) return title.trim();

      return (el.textContent ?? '').trim();
    }

    const h1Count = document.querySelectorAll('h1').length;

    const badSvgOrImg: string[] = [];
    document.querySelectorAll('svg, img').forEach((el, i) => {
      if (isAriaHidden(el)) return;
      if (!accessibleName(el)) {
        badSvgOrImg.push(`${el.tagName.toLowerCase()}#${i}`);
      }
    });

    const badButtons: string[] = [];
    document.querySelectorAll('button').forEach((el, i) => {
      if (isAriaHidden(el)) return;
      if (!accessibleName(el)) {
        badButtons.push(`button#${i}`);
      }
    });

    return { h1Count, badSvgOrImg, badButtons };
  });
}

for (const { name, path } of PAGES) {
  test(`${name} page: exactly one h1, accessible svg/img, accessible buttons`, async ({ page }) => {
    await page.goto(path);
    const result = await accessibilityAudit(page);

    expect(result.h1Count, `${name}: expected exactly one h1`).toBe(1);
    expect(result.badSvgOrImg, `${name}: svg/img missing accessible name or aria-hidden`).toEqual([]);
    expect(result.badButtons, `${name}: buttons missing accessible name`).toEqual([]);
  });
}
