import { Panel } from '@/components/ui/Panel';
import { formatAbsoluteTime } from '@/lib/format';
import type { MarketSummaryVM } from '@/lib/markets/view-models';

export function AnalystNotePanel({ note }: { note: MarketSummaryVM['analystNote'] }) {
  return (
    <Panel title="Analyst note" titleId="analyst-note-title">
      {note ? (
        <>
          <p className="text-sm leading-relaxed text-[var(--text-primary)]">{note.text}</p>
          <p className="mt-2 text-xs text-[var(--text-tertiary)]">
            {note.generationMode === 'LLM' ? 'Model-generated from structured data' : 'Template-generated from structured data'} ·{' '}
            {formatAbsoluteTime(note.createdAt)}
          </p>
        </>
      ) : (
        <p className="text-sm text-[var(--text-tertiary)]">No analyst note available yet.</p>
      )}
    </Panel>
  );
}
