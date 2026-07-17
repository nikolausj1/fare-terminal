'use client';

import { useEffect } from 'react';

export default function HomeError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-start gap-3 px-4 py-16 sm:px-6">
      <h1 className="text-xl font-semibold text-[var(--text-primary)]">Something went wrong</h1>
      <p className="text-sm text-[var(--text-secondary)]">
        The market pulse could not be loaded. This is usually temporary.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
      >
        Try again
      </button>
    </div>
  );
}
