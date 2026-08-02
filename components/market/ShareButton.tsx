'use client';

// WP-F5: upgraded from a single "copy URL" button into a small popover with
// four actions. Origin/destination are parsed from window.location rather
// than passed as props so this component stays a drop-in replacement for
// every existing `<ShareButton />` call site (no caller changes needed) —
// "live VM data" for the markdown action is fetched client-side from this
// same work package's own /api/public/markets/[origin]/[destination] route
// rather than threaded through as a prop, since MarketHeader (the current
// call site) is owned by a different concurrent work package.

import { useEffect, useId, useRef, useState } from 'react';

import { buildMarketUrl } from '@/lib/url-state';
import { buildShareMarkdown, type PublicMarketCard } from '@/lib/markets/share';

type CopyState = 'idle' | 'copied';

const MENU_ITEM_CLASS =
  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--panel)] hover:text-[var(--text-primary)] focus-visible:bg-[var(--panel)] focus-visible:text-[var(--text-primary)] focus-visible:outline-none';

function parseMarketPath(pathname: string): { origin: string; destination: string } | null {
  const match = pathname.match(/^\/market\/([a-z]{3})\/([a-z]{3})(?:\/|$)/i);
  if (!match) return null;
  return { origin: match[1].toUpperCase(), destination: match[2].toUpperCase() };
}

export function ShareButton() {
  const [open, setOpen] = useState(false);
  // Lazy useState initializer (not an effect): resolves once, on first
  // render, which market this button lives on. `window` isn't available
  // during SSR, so this is null there and on the initial (pre-hydration)
  // client render — harmless, since `market` is only read inside the
  // `open && (...)` popover markup, and `open` is always false at that
  // point, so it can never cause a server/client markup mismatch. Falls
  // back to null (plain URL copy/markdown, no fetch) if this ever renders
  // outside /market/[origin]/[destination].
  const [market] = useState<{ origin: string; destination: string } | null>(() =>
    typeof window === 'undefined' ? null : parseMarketPath(window.location.pathname)
  );
  const [card, setCard] = useState<PublicMarketCard | null>(null);
  const [linkCopy, setLinkCopy] = useState<CopyState>('idle');
  const [markdownCopy, setMarkdownCopy] = useState<CopyState>('idle');

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // Fetch the public summary card on demand (popover open) rather than on
  // every page load, so ShareButton adds zero requests for visitors who
  // never open it. Best-effort: a failed/slow fetch just means "Copy
  // markdown" degrades to a bare link instead of `$price ▼pct%`.
  useEffect(() => {
    if (!open || !market || card) return;
    const controller = new AbortController();
    fetch(`/api/public/markets/${market.origin.toLowerCase()}/${market.destination.toLowerCase()}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.market) setCard(json.market as PublicMarketCard);
      })
      .catch(() => {
        /* best-effort, see comment above */
      });
    return () => controller.abort();
  }, [open, market, card]);

  // Escape closes + returns focus to the trigger; outside pointerdown
  // closes; ArrowUp/ArrowDown rove focus between menu items (basic
  // menu-button keyboard pattern — see WAI-ARIA APG "Menu Button").
  useEffect(() => {
    if (!open) return;

    function items(): HTMLElement[] {
      return Array.from(containerRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const list = items();
      if (list.length === 0) return;
      e.preventDefault();
      const current = list.indexOf(document.activeElement as HTMLElement);
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const next = (current + delta + list.length) % list.length;
      list[next]?.focus();
    }

    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    // Move focus onto the first menu item, matching standard menu-button
    // keyboard behavior for users who opened it via Enter/Space.
    const first = containerRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  async function copyText(text: string, setState: (s: CopyState) => void) {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
      setTimeout(() => setState('idle'), 2000);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — fail silently,
      // the URL is still visible in the address bar.
    }
  }

  function canonicalUrl(): string {
    if (market) {
      return `${window.location.origin}${buildMarketUrl(market.origin, market.destination, { mode: 'flexible' })}`;
    }
    return window.location.href;
  }

  function handleCopyLink() {
    void copyText(window.location.href, setLinkCopy);
  }

  function handleCopyMarkdown() {
    const url = canonicalUrl();
    if (card) {
      void copyText(
        buildShareMarkdown({
          origin: card.origin,
          destination: card.destination,
          url,
          priceReliable: card.priceReliable,
          benchmarkPriceMinor: card.benchmarkPriceMinor ?? 0,
          currency: card.currency,
          changePct24h: card.changePct24h,
        }),
        setMarkdownCopy
      );
      return;
    }
    const routeLabel = market ? `${market.origin}→${market.destination}` : document.title;
    void copyText(`[${routeLabel}](${url})`, setMarkdownCopy);
  }

  const ogImageUrl = market
    ? `/api/og/market/${market.origin.toLowerCase()}/${market.destination.toLowerCase()}`
    : '/api/og/index';
  const embedHref = market
    ? `/api/public/markets/${market.origin.toLowerCase()}/${market.destination.toLowerCase()}`
    : '/api/public/markets';

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        <span aria-hidden="true">⇪</span>
        <span>Share</span>
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Share this market"
          className="absolute right-0 z-20 mt-1 w-60 overflow-hidden rounded-md border border-[var(--border-strong)] bg-[var(--panel-raised)] py-1 shadow-lg"
        >
          <button type="button" role="menuitem" onClick={handleCopyLink} className={MENU_ITEM_CLASS}>
            <span aria-hidden="true">🔗</span>
            <span aria-live="polite">{linkCopy === 'copied' ? 'Copied' : 'Copy link'}</span>
          </button>
          <button type="button" role="menuitem" onClick={handleCopyMarkdown} className={MENU_ITEM_CLASS}>
            <span aria-hidden="true">✎</span>
            <span aria-live="polite">{markdownCopy === 'copied' ? 'Copied' : 'Copy markdown'}</span>
          </button>
          <a role="menuitem" href={ogImageUrl} download className={MENU_ITEM_CLASS}>
            <span aria-hidden="true">⇩</span>
            <span>Download card</span>
          </a>
          <a
            role="menuitem"
            href={embedHref}
            target="_blank"
            rel="noopener noreferrer"
            className={MENU_ITEM_CLASS}
            title="Public JSON for this market — see docs/API.md for the full contract."
          >
            <span aria-hidden="true">{'</>'}</span>
            <span>Embed data</span>
          </a>
        </div>
      )}
    </div>
  );
}
