/**
 * Vertical tool panel — sits between the canvas and the command pane.
 * Fixed 40px width, icon buttons stacked top-to-bottom.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useProgramStore } from '../store/program-store';
import { useUIStore } from '../store/ui-store';

// ── SVG Icons ──────────────────────────────────────────────────────────────────

function NewLineIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="2" y1="15" x2="11" y2="4" />
      <line x1="13" y1="10" x2="13" y2="16" />
      <line x1="10" y1="13" x2="16" y2="13" />
    </svg>
  );
}

function NewDotIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="7.5" cy="7.5" r="4" />
      <line x1="13" y1="10" x2="13" y2="16" />
      <line x1="10" y1="13" x2="16" y2="13" />
    </svg>
  );
}

function MergeEndStartIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {/* Two lines converging to a point, then arrow continuing right */}
      <polyline points="1,4 8,8.5 1,13" />
      <line x1="8" y1="8.5" x2="16" y2="8.5" />
      <polyline points="13,6 16,8.5 13,11" />
    </svg>
  );
}

function MergeStartEndIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {/* Arrow from left, then two lines diverging */}
      <line x1="1" y1="8.5" x2="9" y2="8.5" />
      <polyline points="4,6 1,8.5 4,11" />
      <polyline points="9,8.5 16,4" />
      <polyline points="9,8.5 16,13" />
    </svg>
  );
}

function DisconnectIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="1" y1="8.5" x2="5.5" y2="8.5" />
      <line x1="11.5" y1="8.5" x2="16" y2="8.5" />
      {/* X / scissors mark in the gap */}
      <line x1="7" y1="6" x2="10" y2="11" />
      <line x1="10" y1="6" x2="7" y2="11" />
    </svg>
  );
}

function AreaFillLinesIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="3" width="14" height="11" rx="1" />
      <line x1="5" y1="3" x2="5" y2="14" />
      <line x1="9" y1="3" x2="9" y2="14" />
      <line x1="13" y1="3" x2="13" y2="14" />
    </svg>
  );
}

function AreaFillDotsIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="3" width="14" height="11" rx="1" />
      <circle cx="5.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="11.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="5.5" cy="9.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="9.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="11.5" cy="9.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="5.5" cy="12.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="12.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="11.5" cy="12.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function GroupIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 5.5Q1 4.5 2 4.5L5.5 4.5L7 6L14 6Q15 6 15 7L15 13Q15 14 14 14L2 14Q1 14 1 13Z" />
      <line x1="11" y1="9.5" x2="11" y2="13" />
      <line x1="9" y1="11.25" x2="13" y2="11.25" />
    </svg>
  );
}

function UngroupIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 5.5Q1 4.5 2 4.5L5.5 4.5L7 6L14 6Q15 6 15 7L15 13Q15 14 14 14L2 14Q1 14 1 13Z" />
      <line x1="9.5" y1="9.5" x2="12.5" y2="12.5" />
      <line x1="12.5" y1="9.5" x2="9.5" y2="12.5" />
    </svg>
  );
}

// ── Tool Button ────────────────────────────────────────────────────────────────

interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
}

function ToolButton({ icon, label, onClick, disabled = false, active = false }: ToolButtonProps) {
  return (
    <div className="relative group">
      <button
        onClick={disabled ? undefined : onClick}
        className={[
          'w-10 h-10 flex items-center justify-center transition-colors text-gray-300',
          'border-l-2',
          active
            ? 'bg-blue-600/30 border-blue-400 text-blue-200'
            : disabled
            ? 'border-transparent opacity-30 cursor-default'
            : 'border-transparent hover:bg-gray-600/60 hover:text-gray-100 cursor-pointer',
        ].join(' ')}
        tabIndex={-1}
      >
        {icon}
      </button>
      {/* Tooltip — delayed, appears to the right */}
      <div
        className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2 py-1 bg-gray-900 border border-gray-600 text-xs text-gray-200 rounded whitespace-nowrap z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-100 delay-500"
      >
        {label}
      </div>
    </div>
  );
}

// ── Divider ────────────────────────────────────────────────────────────────────

function Divider() {
  return <div className="mx-2 my-1 border-t border-gray-700" />;
}

// ── Group Name Prompt ──────────────────────────────────────────────────────────

interface GroupPromptProps {
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

function GroupPrompt({ onConfirm, onCancel }: GroupPromptProps) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && name.trim()) { onConfirm(name.trim()); }
    if (e.key === 'Escape') { onCancel(); }
    e.stopPropagation();
  };

  return (
    <div className="absolute left-full top-0 ml-1 z-50 bg-gray-800 border border-gray-600 rounded shadow-xl p-2 w-44">
      <div className="text-[10px] text-gray-400 mb-1">Group name</div>
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKey}
        className="w-full bg-gray-700 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-gray-100 focus:outline-none focus:border-blue-500"
        placeholder="My Group"
      />
      <div className="flex gap-1 mt-1.5">
        <button
          onClick={() => name.trim() && onConfirm(name.trim())}
          disabled={!name.trim()}
          className="flex-1 text-[10px] bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-default text-white rounded px-1 py-0.5"
        >
          Create
        </button>
        <button
          onClick={onCancel}
          className="flex-1 text-[10px] bg-gray-700 hover:bg-gray-600 text-gray-300 rounded px-1 py-0.5"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ToolPanel() {
  const program             = useProgramStore((s) => s.program);
  const selectedPatternName = useProgramStore((s) => s.selectedPatternName);
  const selectedCommandIds  = useProgramStore((s) => s.selectedCommandIds);
  const mergeEndToStart     = useProgramStore((s) => s.mergeEndToStart);
  const mergeStartToEnd     = useProgramStore((s) => s.mergeStartToEnd);
  const disconnectLines     = useProgramStore((s) => s.disconnectLines);
  const groupSelection      = useProgramStore((s) => s.groupSelection);
  const ungroupSelection    = useProgramStore((s) => s.ungroupSelection);

  const activeTool    = useUIStore((s) => s.activeTool);
  const setActiveTool = useUIStore((s) => s.setActiveTool);

  const [groupPromptOpen, setGroupPromptOpen] = useState(false);

  // ── Selection-derived enable flags ──────────────────────────────────────────

  const canEdit = Boolean(program && selectedPatternName !== null);

  const { selectedLineCount, hasConnectedPair, hasSelectedGroup } =
    React.useMemo(() => {
      if (!canEdit || !program || selectedPatternName === null) {
        return { selectedLineCount: 0, hasConnectedPair: false, hasSelectedGroup: false };
      }
      const pattern = program.patterns.find((p) => p.name === selectedPatternName);
      if (!pattern) return { selectedLineCount: 0, hasConnectedPair: false, hasSelectedGroup: false };
      const patternCmds = pattern.commands;

      // Collect selected Lines in document order
      function collectLines(cmds: typeof patternCmds): import('@lib/types').LineCommand[] {
        const r: import('@lib/types').LineCommand[] = [];
        for (const c of cmds) {
          if (c.kind === 'Line' && c.id && selectedCommandIds.has(c.id)) r.push(c);
          else if (c.kind === 'Group') r.push(...collectLines(c.commands));
        }
        return r;
      }

      const lines = collectLines(patternCmds);
      const ptKey = (p: [number, number, number]) =>
        `${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)}`;

      let hasConnected = false;
      for (let i = 0; i < lines.length - 1; i++) {
        if (ptKey(lines[i].endPoint) === ptKey(lines[i + 1].startPoint)) {
          hasConnected = true;
          break;
        }
      }

      const hasGroup = patternCmds.some(
        (c) => c.kind === 'Group' && c.id && selectedCommandIds.has(c.id),
      );

      return { selectedLineCount: lines.length, hasConnectedPair: hasConnected, hasSelectedGroup: hasGroup };
    }, [canEdit, program, selectedPatternName, selectedCommandIds]);

  const canMerge      = canEdit && selectedLineCount === 2;
  const canDisconnect = canEdit && hasConnectedPair;
  const canGroup      = canEdit && selectedCommandIds.size > 0;
  const canUngroup    = canEdit && hasSelectedGroup;

  // ── Handlers ────────────────────────────────────────────────────────────────

  const toggleTool = useCallback((tool: 'new-line' | 'new-dot') => {
    setActiveTool(activeTool === tool ? null : tool);
  }, [activeTool, setActiveTool]);

  const handleGroupConfirm = useCallback((name: string) => {
    groupSelection(name);
    setGroupPromptOpen(false);
  }, [groupSelection]);

  // Close group prompt on Escape
  useEffect(() => {
    if (!groupPromptOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setGroupPromptOpen(false); e.stopPropagation(); }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [groupPromptOpen]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col items-center py-1 bg-gray-750 border-x border-gray-700 shrink-0 overflow-visible"
      style={{ width: 40, background: '#1e2433' }}
    >
      <ToolButton
        icon={<NewLineIcon />}
        label="New Line (click 2 points)"
        active={activeTool === 'new-line'}
        disabled={!canEdit}
        onClick={() => toggleTool('new-line')}
      />
      <ToolButton
        icon={<NewDotIcon />}
        label="New Dot (click to place)"
        active={activeTool === 'new-dot'}
        disabled={!canEdit}
        onClick={() => toggleTool('new-dot')}
      />

      <Divider />

      <ToolButton
        icon={<MergeEndStartIcon />}
        label="Merge: move 1st end → 2nd start"
        disabled={!canMerge}
        onClick={mergeEndToStart}
      />
      <ToolButton
        icon={<MergeStartEndIcon />}
        label="Merge: move 2nd start → 1st end"
        disabled={!canMerge}
        onClick={mergeStartToEnd}
      />
      <ToolButton
        icon={<DisconnectIcon />}
        label="Disconnect joined lines"
        disabled={!canDisconnect}
        onClick={disconnectLines}
      />

      <Divider />

      <ToolButton
        icon={<AreaFillLinesIcon />}
        label="Area Fill — Lines (coming soon)"
        disabled
      />
      <ToolButton
        icon={<AreaFillDotsIcon />}
        label="Area Fill — Dots (coming soon)"
        disabled
      />

      <Divider />

      {/* Group button — has inline prompt */}
      <div className="relative">
        <ToolButton
          icon={<GroupIcon />}
          label="Group selection"
          disabled={!canGroup}
          onClick={() => setGroupPromptOpen((v) => !v)}
        />
        {groupPromptOpen && (
          <GroupPrompt
            onConfirm={handleGroupConfirm}
            onCancel={() => setGroupPromptOpen(false)}
          />
        )}
      </div>

      <ToolButton
        icon={<UngroupIcon />}
        label="Ungroup"
        disabled={!canUngroup}
        onClick={ungroupSelection}
      />
    </div>
  );
}
