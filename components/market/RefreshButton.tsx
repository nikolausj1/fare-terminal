'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function RefreshButton({ origin, destination }: { origin: string; destination: string }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    setState('loading');
    setMessage(null);
    try {
      const res = await fetch(`/api/markets/${origin.toLowerCase()}/${destination.toLowerCase()}/refresh`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        setState('error');
        setMessage(data?.error?.message ?? 'Refresh failed.');
        return;
      }
      if (data.refreshed === false) {
        setState('done');
        setMessage(
          data.reason === 'rate-limited'
            ? 'Refresh already ran recently — try again shortly.'
            : 'Refresh is unavailable in this deployment.'
        );
        return;
      }
      setState('done');
      setMessage('Updated.');
      router.refresh();
    } catch {
      setState('error');
      setMessage('Refresh failed.');
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={refresh}
        disabled={state === 'loading'}
        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
      >
        <span aria-hidden="true">{state === 'loading' ? '⟳' : '↻'}</span>
        {state === 'loading' ? 'Refreshing…' : 'Refresh'}
      </button>
      {message && (
        <span role="status" className="text-xs text-[var(--text-tertiary)]">
          {message}
        </span>
      )}
    </div>
  );
}
