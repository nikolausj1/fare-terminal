import Link from 'next/link';

// WP-P2: this deployment is a personal fare terminal with a fixed home
// airport, surfaced globally in the nav (not just on the "From Seattle"
// home board) so it's visible from every page, not only "/". Hardcoded to
// SEA for now, matching the home board's origin — if a configurable home
// airport lands later, both should read from the same source.
const HOME_AIRPORT = 'SEA';

export function NavBar() {
  return (
    <nav className="border-b border-[var(--border)] bg-[var(--bg)]">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="num text-sm font-bold tracking-widest text-[var(--text-primary)]">
          FARE TERMINAL
        </Link>
        <div className="flex items-center gap-4 text-sm text-[var(--text-secondary)]">
          <span
            className="num inline-flex items-center rounded-full border border-[var(--border-strong)] px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)]"
            title="Home airport"
          >
            Home: {HOME_AIRPORT}
          </span>
          <Link href="/methodology" className="hover:text-[var(--accent)]">
            Methodology
          </Link>
          <Link href="/about" className="hover:text-[var(--accent)]">
            About
          </Link>
        </div>
      </div>
    </nav>
  );
}
