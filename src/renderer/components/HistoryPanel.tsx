/**
 * History panel — shows the undo/redo history as a scrollable list.
 * Newest entries appear at the top.
 */
import React, { useEffect, useRef } from 'react';
import { useProgramStore, type HistoryEntry } from '../store/program-store';
import { useUIStore } from '../store/ui-store';

// ── Icons ─────────────────────────────────────────────────────────────────────

function DotIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="3.5" fill="currentColor" />
    </svg>
  );
}

function LineIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="2" y1="10" x2="10" y2="2" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <line x1="2" y1="4" x2="10" y2="4" />
      <line x1="2" y1="8" x2="10" y2="8" />
      <line x1="4" y1="2" x2="4" y2="10" />
      <line x1="8" y1="2" x2="8" y2="10" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 3.5Q1 3 1.5 3L4.5 3L5.5 4.5L10.5 4.5Q11 4.5 11 5L11 9Q11 9.5 10.5 9.5L1.5 9.5Q1 9.5 1 9Z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <circle cx="6" cy="6" r="4.5" />
      <line x1="6" y1="3.5" x2="6" y2="6" />
      <line x1="6" y1="6" x2="8" y2="7.5" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2L10 4L4 10L1.5 10.5L2 8Z" />
    </svg>
  );
}

function iconForLabel(label: string): React.ReactNode {
  const l = label.toLowerCase();
  if (l === 'file opened') return <ClockIcon />;
  if (l.includes('dot') || l.includes('create dot')) return <DotIcon />;
  if (l.includes('line') || l.includes('create line') || l.includes('endpoint') || l.includes('merge') || l.includes('disconnect')) return <LineIcon />;
  if (l.includes('area fill')) return <GridIcon />;
  if (l.includes('group') || l.includes('ungroup')) return <FolderIcon />;
  return <EditIcon />;
}

// ── Relative time ─────────────────────────────────────────────────────────────

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 5_000)  return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1_000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

// ── Entry row ─────────────────────────────────────────────────────────────────

interface EntryRowProps {
  entry: HistoryEntry;
  isCurrent: boolean;
  isFuture: boolean;
  onClick: () => void;
  entryRef?: React.RefObject<HTMLDivElement>;
}

function EntryRow({ entry, isCurrent, isFuture, onClick, entryRef }: EntryRowProps) {
  return (
    <div
      ref={entryRef}
      onClick={onClick}
      className={[
        'flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none group',
        'border-l-2 transition-colors',
        isCurrent
          ? 'border-amber-400 bg-amber-900/20 hover:bg-amber-900/30'
          : isFuture
          ? 'border-dashed border-gray-600 hover:bg-gray-700/40'
          : 'border-transparent hover:bg-gray-700/40',
      ].join(' ')}
      style={{ opacity: isFuture ? 0.5 : 1 }}
    >
      {/* Icon */}
      <span className={[
        'shrink-0',
        isCurrent ? 'text-amber-400' : isFuture ? 'text-gray-500' : 'text-gray-400',
      ].join(' ')}>
        {iconForLabel(entry.label)}
      </span>

      {/* Label */}
      <span className={[
        'flex-1 text-xs truncate',
        isCurrent ? 'text-amber-200 font-semibold' : isFuture ? 'text-gray-500' : 'text-gray-300',
      ].join(' ')}>
        {entry.label}
        {isFuture && <span className="ml-1 text-[10px] text-gray-600 italic">undone</span>}
      </span>

      {/* Timestamp */}
      <span className="text-[10px] text-gray-600 shrink-0 group-hover:text-gray-500">
        {relativeTime(entry.timestamp)}
      </span>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function HistoryPanel() {
  const historyEntries      = useProgramStore((s) => s.historyEntries);
  const historyCurrentIndex = useProgramStore((s) => s.historyCurrentIndex);
  const jumpToHistory       = useProgramStore((s) => s.jumpToHistory);
  const setHistoryPanelOpen = useUIStore((s) => s.setHistoryPanelOpen);

  const currentRowRef = useRef<HTMLDivElement>(null);

  // Scroll current entry into view when it changes (keyboard undo/redo)
  useEffect(() => {
    currentRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [historyCurrentIndex]);

  // Reverse order — newest at top
  const reversedIndices = Array.from({ length: historyEntries.length }, (_, i) => historyEntries.length - 1 - i);

  return (
    <div className="flex flex-col h-full border-l border-gray-700 bg-gray-900" style={{ width: 220, minWidth: 220 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-300">
          <ClockIcon />
          <span>History</span>
        </div>
        <button
          onClick={() => setHistoryPanelOpen(false)}
          className="text-gray-500 hover:text-gray-200 text-base leading-none px-0.5"
          aria-label="Close history"
        >
          ×
        </button>
      </div>

      {/* Entry list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {historyEntries.length === 0 ? (
          <div className="px-3 py-4 text-xs text-gray-600 text-center">No history yet</div>
        ) : (
          reversedIndices.map((originalIndex) => {
            const entry     = historyEntries[originalIndex];
            const isCurrent = originalIndex === historyCurrentIndex;
            const isFuture  = originalIndex > historyCurrentIndex;
            return (
              <EntryRow
                key={entry.id}
                entry={entry}
                isCurrent={isCurrent}
                isFuture={isFuture}
                onClick={() => jumpToHistory(originalIndex)}
                entryRef={isCurrent ? currentRowRef : undefined}
              />
            );
          })
        )}
      </div>

      {/* Footer: entry count */}
      {historyEntries.length > 0 && (
        <div className="px-3 py-1.5 border-t border-gray-700 text-[10px] text-gray-600 shrink-0 text-right">
          {historyCurrentIndex + 1} / {historyEntries.length}
        </div>
      )}
    </div>
  );
}
