import Link from 'next/link';

export function NavBar() {
  return (
    <nav className="border-b border-[var(--border)] bg-[var(--bg)]">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="num text-sm font-bold tracking-widest text-[var(--text-primary)]">
          FARE TERMINAL
        </Link>
        <div className="flex items-center gap-4 text-sm text-[var(--text-secondary)]">
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
