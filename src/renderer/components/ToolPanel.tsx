/**
 * Vertical tool panel — sits between the canvas and the command pane.
 * Fixed 40px width, icon buttons stacked top-to-bottom.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useProgramStore, genId } from '../store/program-store';
import { useUIStore } from '../store/ui-store';
import AreaFillPanel, { useAnchorRect } from './AreaFillPanel';
import { valveColor } from './visualization/renderers';
import { useT } from '../hooks/useT';

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

function NewCommentIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {/* Speech bubble */}
      <path d="M2 3.5Q2 2.5 3 2.5L14 2.5Q15 2.5 15 3.5L15 10Q15 11 14 11L9 11L6.5 13.5L6.5 11L3 11Q2 11 2 10Z" />
      {/* + badge */}
      <line x1="13" y1="5" x2="13" y2="9" />
      <line x1="11" y1="7" x2="15" y2="7" />
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

function SplitLineIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      {/* Line segment */}
      <line x1="2" y1="14" x2="15" y2="3" />
      {/* Scissors / break mark at midpoint */}
      <line x1="6.5" y1="7" x2="9" y2="10" stroke="currentColor" strokeWidth="1.2" />
      <line x1="9" y1="7" x2="6.5" y2="10" stroke="currentColor" strokeWidth="1.2" />
      {/* Gap dots at break */}
      <circle cx="7.75" cy="8.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="2,5 15,5" />
      <path d="M6 5V3.5Q6 3 6.5 3L10.5 3Q11 3 11 3.5V5" />
      <path d="M4 5L4.8 14Q4.9 14.5 5.5 14.5L11.5 14.5Q12.1 14.5 12.2 14L13 5" />
      <line x1="7" y1="8" x2="7" y2="12" />
      <line x1="10" y1="8" x2="10" y2="12" />
    </svg>
  );
}

function JoinLinesIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      {/* Two segments converging to one */}
      <line x1="2" y1="13" x2="8" y2="8.5" />
      <line x1="2" y1="4" x2="8" y2="8.5" />
      <line x1="8" y1="8.5" x2="15" y2="8.5" />
      <polyline points="12,6.5 15,8.5 12,10.5" />
    </svg>
  );
}

/** Hatched polygon — represents the Area Fill tool. */
function AreaFillIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {/* Pentagon outline */}
      <polygon points="8.5,2 15,7 12.5,14.5 4.5,14.5 2,7" />
      {/* Hatch lines clipped roughly inside */}
      <line x1="5" y1="6" x2="7.5" y2="14.5" />
      <line x1="8.5" y1="4.5" x2="11" y2="14.5" />
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

// ── Param Selector ─────────────────────────────────────────────────────────────

interface ParamSelectorProps {
  activeParam: number;
  setActiveParam: (n: number) => void;
}

function ParamSelector({ activeParam, setActiveParam }: ParamSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', handler, true);
    return () => window.removeEventListener('mousedown', handler, true);
  }, [open]);

  const color = valveColor(activeParam);

  return (
    <div
      ref={containerRef}
      className="absolute right-full top-1/2 -translate-y-1/2 mr-1.5 z-50"
    >
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap transition-opacity"
        style={{
          color,
          background: 'rgba(15,20,30,0.92)',
          border: `1px solid ${color}55`,
          boxShadow: `0 0 6px ${color}33`,
        }}
      >
        P{activeParam}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-gray-900 border border-gray-700 rounded shadow-2xl py-0.5 min-w-[90px]">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              onClick={(e) => { e.stopPropagation(); setActiveParam(n); setOpen(false); }}
              className={`flex items-center gap-2 w-full px-2 py-[3px] text-xs text-left transition-colors ${n === activeParam ? 'bg-gray-700/60' : 'hover:bg-gray-700/40'}`}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: valveColor(n) }}
              />
              <span style={{ color: valveColor(n) }}>Param {n}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Comment Tool Prompt ────────────────────────────────────────────────────────

const RESERVED_PREFIXES = ['##GROUP:', '##ENDGROUP:', '##AREA_FILL_CONFIG:'];

interface CommentToolPromptProps {
  value: string;
  onChange: (text: string) => void;
  onPlace: (text: string) => void;
  onCancel: () => void;
}

function CommentToolPrompt({ value, onChange, onPlace, onCancel }: CommentToolPromptProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handlePlace = () => {
    const txt = value.trim();
    if (!txt) return;
    const reserved = RESERVED_PREFIXES.find((p) => txt.startsWith(p));
    if (reserved) {
      setToast(t('comment.reserved'));
      setTimeout(() => setToast(null), 3500);
      return;
    }
    onPlace(txt);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { handlePlace(); }
    if (e.key === 'Escape') { onCancel(); }
    e.stopPropagation();
  };

  return (
    <div className="absolute right-full top-0 mr-1.5 z-50 flex flex-col gap-1">
      <div
        className="flex items-center bg-gray-800 border border-gray-600 rounded shadow-xl"
        style={{ minWidth: 200 }}
      >
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKey}
          placeholder={t('comment.placeholder')}
          className="flex-1 bg-transparent px-2 py-1 text-xs text-gray-100 focus:outline-none placeholder-gray-500"
        />
        <button
          onClick={handlePlace}
          disabled={!value.trim()}
          className="px-2 py-1 text-[10px] text-blue-400 hover:text-blue-300 disabled:opacity-30 disabled:cursor-default border-l border-gray-600"
          title="Place comment (Enter)"
        >
          ✓
        </button>
      </div>
      {toast && (
        <div className="bg-red-900 border border-red-600 text-red-100 text-[10px] px-2 py-1 rounded shadow-xl leading-tight" style={{ maxWidth: 220 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// ── Chain Mode Checkbox ────────────────────────────────────────────────────────

function ChainModeCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const t = useT();
  return (
    <div className="absolute right-full top-1/2 -translate-y-1/2 mr-1.5 z-50">
      <label
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap cursor-pointer select-none"
        style={{ background: 'rgba(15,20,30,0.92)', border: '1px solid #ffffff22', color: checked ? '#93c5fd' : '#9ca3af' }}
        title={t('chain.tooltip')}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="w-2.5 h-2.5 accent-blue-500"
        />
        {t('chain.label')}
      </label>
    </div>
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
  const t = useT();
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
      <div className="text-[10px] text-gray-400 mb-1">{t('group.nameLabel')}</div>
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKey}
        className="w-full bg-gray-700 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-gray-100 focus:outline-none focus:border-blue-500"
        placeholder={t('group.namePh')}
      />
      <div className="flex gap-1 mt-1.5">
        <button
          onClick={() => name.trim() && onConfirm(name.trim())}
          disabled={!name.trim()}
          className="flex-1 text-[10px] bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-default text-white rounded px-1 py-0.5"
        >
          {t('dialog.create')}
        </button>
        <button
          onClick={onCancel}
          className="flex-1 text-[10px] bg-gray-700 hover:bg-gray-600 text-gray-300 rounded px-1 py-0.5"
        >
          {t('dialog.cancel')}
        </button>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ToolPanel() {
  const t                   = useT();
  const program             = useProgramStore((s) => s.program);
  const selectedPatternName = useProgramStore((s) => s.selectedPatternName);
  const selectedCommandIds  = useProgramStore((s) => s.selectedCommandIds);
  const mergeEndToStart     = useProgramStore((s) => s.mergeEndToStart);
  const mergeStartToEnd     = useProgramStore((s) => s.mergeStartToEnd);
  const disconnectLines     = useProgramStore((s) => s.disconnectLines);
  const groupSelection      = useProgramStore((s) => s.groupSelection);
  const ungroupSelection    = useProgramStore((s) => s.ungroupSelection);
  const deleteSelection     = useProgramStore((s) => s.deleteSelection);

  const activeTool             = useUIStore((s) => s.activeTool);
  // split-line and join-lines are canvas-driven; toolbar just activates them
  const setActiveTool          = useUIStore((s) => s.setActiveTool);
  const clearAreaFill          = useUIStore((s) => s.clearAreaFill);
  const setAreaFillEditGroupId = useUIStore((s) => s.setAreaFillEditGroupId);
  const activeParam            = useUIStore((s) => s.activeParam);
  const setActiveParam         = useUIStore((s) => s.setActiveParam);
  const chainMode              = useUIStore((s) => s.chainMode);
  const setChainMode           = useUIStore((s) => s.setChainMode);
  const pendingCommentText     = useUIStore((s) => s.pendingCommentText);
  const setPendingCommentText  = useUIStore((s) => s.setPendingCommentText);
  const insertAboveSelection   = useProgramStore((s) => s.insertAboveSelection);

  const toolPanelRef = useRef<HTMLDivElement>(null);
  const anchorRect   = useAnchorRect(toolPanelRef as React.RefObject<HTMLElement>);

  const [groupPromptOpen, setGroupPromptOpen] = useState(false);

  // ── Selection-derived enable flags ──────────────────────────────────────────

  const canEdit = Boolean(program && selectedPatternName !== null);

  const { selectedLineCount, hasConnectedPair, hasSelectedGroup, selectedGroup } =
    React.useMemo(() => {
      if (!canEdit || !program || selectedPatternName === null) {
        return { selectedLineCount: 0, hasConnectedPair: false, hasSelectedGroup: false, selectedGroup: null };
      }
      const pattern = program.patterns.find((p) => p.name === selectedPatternName);
      if (!pattern) return { selectedLineCount: 0, hasConnectedPair: false, hasSelectedGroup: false, selectedGroup: null };
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

      const selectedGroupCmd = patternCmds.find(
        (c) => c.kind === 'Group' && c.id && selectedCommandIds.has(c.id),
      ) as import('@lib/types').GroupNode | undefined;

      return {
        selectedLineCount: lines.length,
        hasConnectedPair: hasConnected,
        hasSelectedGroup: Boolean(selectedGroupCmd),
        selectedGroup: selectedGroupCmd ?? null,
      };
    }, [canEdit, program, selectedPatternName, selectedCommandIds]);

  const canMerge      = canEdit && selectedLineCount >= 2;
  const canDisconnect = canEdit && hasConnectedPair;
  const canGroup      = canEdit && selectedCommandIds.size > 0;
  const canUngroup    = canEdit && hasSelectedGroup;
  // split-line and join-lines are always available when a pattern is open;
  // the canvas handles the "nothing to click" case gracefully
  const canSplitJoin  = canEdit;

  // ── Handlers ────────────────────────────────────────────────────────────────

  const toggleTool = useCallback((tool: 'new-line' | 'new-dot' | 'new-comment' | 'area-fill' | 'split-line' | 'join-lines' | 'delete-item') => {
    if (activeTool === tool) {
      setActiveTool(null);
      if (tool === 'area-fill') clearAreaFill();
      if (tool === 'new-comment') setPendingCommentText('');
    } else {
      if (activeTool === 'area-fill') clearAreaFill();
      if (activeTool === 'new-comment') setPendingCommentText('');
      if (tool === 'area-fill' && selectedGroup?.id) {
        setAreaFillEditGroupId(selectedGroup.id);
      }
      setActiveTool(tool);
    }
  }, [activeTool, setActiveTool, clearAreaFill, setAreaFillEditGroupId, selectedGroup, setPendingCommentText]);

  const handleGroupConfirm = useCallback((name: string) => {
    groupSelection(name);
    setGroupPromptOpen(false);
  }, [groupSelection]);

  const handlePlaceComment = useCallback((text: string) => {
    const newCmd = { kind: 'Comment' as const, id: genId(), text };
    insertAboveSelection(newCmd, 'Add comment');
    setPendingCommentText(''); // clear for next placement, keep tool active
  }, [insertAboveSelection, setPendingCommentText]);

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
    <div
      ref={toolPanelRef}
      className="flex flex-col items-center py-1 bg-gray-750 border-x border-gray-700 shrink-0 overflow-visible"
      style={{ width: 40, background: '#1e2433' }}
    >
      <div className="relative">
        <ToolButton
          icon={<NewLineIcon />}
          label={t('tool.newLine')}
          active={activeTool === 'new-line'}
          disabled={!canEdit}
          onClick={() => toggleTool('new-line')}
        />
        {activeTool === 'new-line' && (
          <>
            <ParamSelector activeParam={activeParam} setActiveParam={setActiveParam} />
            <ChainModeCheckbox checked={chainMode} onChange={setChainMode} />
          </>
        )}
      </div>
      <div className="relative">
        <ToolButton
          icon={<NewDotIcon />}
          label={t('tool.newDot')}
          active={activeTool === 'new-dot'}
          disabled={!canEdit}
          onClick={() => toggleTool('new-dot')}
        />
        {activeTool === 'new-dot' && (
          <ParamSelector activeParam={activeParam} setActiveParam={setActiveParam} />
        )}
      </div>
      <div className="relative">
        <ToolButton
          icon={<NewCommentIcon />}
          label={t('tool.newComment')}
          active={activeTool === 'new-comment'}
          disabled={!canEdit}
          onClick={() => toggleTool('new-comment')}
        />
        {activeTool === 'new-comment' && (
          <CommentToolPrompt
            value={pendingCommentText}
            onChange={setPendingCommentText}
            onPlace={handlePlaceComment}
            onCancel={() => toggleTool('new-comment')}
          />
        )}
      </div>

      <Divider />

      <ToolButton
        icon={<MergeEndStartIcon />}
        label={t('tool.mergeES')}
        disabled={!canMerge}
        onClick={mergeEndToStart}
      />
      <ToolButton
        icon={<MergeStartEndIcon />}
        label={t('tool.mergeSE')}
        disabled={!canMerge}
        onClick={mergeStartToEnd}
      />
      <ToolButton
        icon={<DisconnectIcon />}
        label={t('tool.disconnect')}
        disabled={!canDisconnect}
        onClick={disconnectLines}
      />
      <ToolButton
        icon={<SplitLineIcon />}
        label={t('tool.splitLine')}
        active={activeTool === 'split-line'}
        disabled={!canSplitJoin}
        onClick={() => toggleTool('split-line')}
      />
      <ToolButton
        icon={<JoinLinesIcon />}
        label={t('tool.joinLines')}
        active={activeTool === 'join-lines'}
        disabled={!canSplitJoin}
        onClick={() => toggleTool('join-lines')}
      />

      <Divider />

      <ToolButton
        icon={<AreaFillIcon />}
        label={t('tool.areaFill')}
        active={activeTool === 'area-fill'}
        disabled={!canEdit}
        onClick={() => toggleTool('area-fill')}
      />

      <Divider />

      {/* Group button — has inline prompt */}
      <div className="relative">
        <ToolButton
          icon={<GroupIcon />}
          label={t('tool.group')}
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
        label={t('tool.ungroup')}
        disabled={!canUngroup}
        onClick={ungroupSelection}
      />

      <Divider />

      {/* Delete: Mode 1 (immediate) if selection exists; Mode 2 (click-to-delete) otherwise */}
      <ToolButton
        icon={<TrashIcon />}
        label={
          selectedCommandIds.size > 0
            ? t('tool.deleteSelected', { count: String(selectedCommandIds.size) })
            : t('tool.deleteTool')
        }
        active={activeTool === 'delete-item'}
        disabled={!canEdit}
        onClick={() => {
          if (selectedCommandIds.size > 0) {
            deleteSelection();
          } else {
            toggleTool('delete-item');
          }
        }}
      />

      {activeTool === 'area-fill' && anchorRect && (
        <AreaFillPanel
          anchorRect={anchorRect}
          onCancel={() => { setActiveTool(null); clearAreaFill(); }}
        />
      )}
    </div>
  );
}
