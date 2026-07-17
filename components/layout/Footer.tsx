import Link from 'next/link';

export function Footer() {
  return (
    <footer className="border-t border-[var(--border)] py-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 text-xs text-[var(--text-tertiary)] sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          Synthetic demo data unless noted otherwise. Not financial, travel, or booking advice — see the{' '}
          <Link href="/methodology" className="text-[var(--accent)] hover:underline">
            methodology
          </Link>{' '}
          and{' '}
          <Link href="/about" className="text-[var(--accent)] hover:underline">
            about
          </Link>{' '}
          pages.
        </p>
        <a
          href="https://github.com/nikolausj1/fare-terminal"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--accent)] hover:underline"
        >
          GitHub
        </a>
      </div>
    </footer>
  );
}
