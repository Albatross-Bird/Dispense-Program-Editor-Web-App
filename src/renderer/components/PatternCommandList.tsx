import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PatternCommand, LineCommand, GroupNode } from '@lib/types';
import { serializePatternCommand } from '@lib/serializer';
import { valveColor } from './visualization/renderers';

// ── Chain detection helpers ───────────────────────────────────────────────────

function lineEndKey(cmd: LineCommand): string {
  return (
    cmd._raw?.endPoint ??
    `(${cmd.endPoint[0].toFixed(3)},${cmd.endPoint[1].toFixed(3)},${cmd.endPoint[2].toFixed(3)})`
  );
}

function lineStartKey(cmd: LineCommand): string {
  return (
    cmd._raw?.startPoint ??
    `(${cmd.startPoint[0].toFixed(3)},${cmd.startPoint[1].toFixed(3)},${cmd.startPoint[2].toFixed(3)})`
  );
}

// ── Internal types ────────────────────────────────────────────────────────────

type ChainPos = 'start' | 'middle' | 'end' | null;

type SelectMode = 'single' | 'toggle' | 'range';

interface FlatItem {
  key: string;
  /** id of the underlying PatternCommand (undefined for group headers lacking id) */
  cmdId: string | undefined;
  cmd: PatternCommand;
  depth: number;
  isGroupHeader: boolean;
  groupCollapsed: boolean;
  chainPos: ChainPos;
  chainColor: string;
}

// ── Flat-item builder ─────────────────────────────────────────────────────────

function buildFlatItems(
  commands: PatternCommand[],
  collapsedGroups: Set<string>,
): FlatItem[] {
  const items: FlatItem[] = [];

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    const baseKey = String(i);

    if (cmd.kind === 'Group') {
      const collapsed = collapsedGroups.has(baseKey);
      items.push({
        key: baseKey, cmdId: cmd.id, cmd, depth: 0,
        isGroupHeader: true, groupCollapsed: collapsed,
        chainPos: null, chainColor: '',
      });
      if (!collapsed) {
        for (let j = 0; j < cmd.commands.length; j++) {
          const child = cmd.commands[j];
          items.push({
            key: `${i}-${j}`, cmdId: child.id, cmd: child,
            depth: 1, isGroupHeader: false, groupCollapsed: false,
            chainPos: null, chainColor: '',
          });
        }
      }
    } else {
      items.push({
        key: baseKey, cmdId: cmd.id, cmd, depth: 0,
        isGroupHeader: false, groupCollapsed: false,
        chainPos: null, chainColor: '',
      });
    }
  }

  // Annotate chain positions: runs of consecutive connected Line items at the same depth
  for (let i = 0; i < items.length; ) {
    const it = items[i];
    if (it.isGroupHeader || it.cmd.kind !== 'Line') { i++; continue; }

    let j = i;
    while (
      j + 1 < items.length &&
      !items[j + 1].isGroupHeader &&
      items[j + 1].cmd.kind === 'Line' &&
      items[j + 1].depth === it.depth &&
      lineEndKey(items[j].cmd as LineCommand) === lineStartKey(items[j + 1].cmd as LineCommand)
    ) j++;

    if (j > i) {
      const chainColor = valveColor((it.cmd as LineCommand).valve);
      items[i].chainPos = 'start';  items[i].chainColor = chainColor;
      for (let k = i + 1; k < j; k++) { items[k].chainPos = 'middle'; items[k].chainColor = chainColor; }
      items[j].chainPos = 'end'; items[j].chainColor = chainColor;
      i = j + 1;
    } else {
      i++;
    }
  }

  return items;
}

// ── Chain connector gutter ────────────────────────────────────────────────────

function ChainConnector({ pos, color }: { pos: ChainPos; color: string }) {
  if (!pos) return <div style={{ width: 16, flexShrink: 0 }} />;
  const bar: React.CSSProperties = { position: 'absolute', left: 7, width: 2, background: color };
  const tick: React.CSSProperties = { position: 'absolute', left: 7, width: 7, height: 2, background: color };
  return (
    <div style={{ width: 16, flexShrink: 0, position: 'relative', alignSelf: 'stretch' }}>
      {(pos === 'middle' || pos === 'end')   && <div style={{ ...bar, top: 0, bottom: '50%' }} />}
      {(pos === 'start' || pos === 'middle') && <div style={{ ...bar, top: '50%', bottom: 0 }} />}
      {(pos === 'start' || pos === 'end')    && <div style={{ ...tick, top: 'calc(50% - 1px)' }} />}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPt(p: [number, number, number]): string {
  return `${p[0].toFixed(3)}, ${p[1].toFixed(3)}, ${p[2].toFixed(3)}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface PatternCommandListProps {
  commands: PatternCommand[];
  selectedCommandIds: Set<string>;
  lastSelectedId: string | null;
  onSelect: (id: string, mode: SelectMode, allIds: string[]) => void;
  onClear: () => void;
  onContextMenu?: (e: React.MouseEvent, cmdId: string | undefined) => void;
}

export default function PatternCommandList({
  commands,
  selectedCommandIds,
  lastSelectedId,
  onSelect,
  onClear,
  onContextMenu,
}: PatternCommandListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [shiftHeld, setShiftHeld] = useState(false);
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  // Track shift key globally
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const items = useMemo(
    () => buildFlatItems(commands, collapsedGroups),
    [commands, collapsedGroups],
  );

  // All IDs in the current visible order (for range selection)
  const allVisibleIds = useMemo(
    () => items.map((it) => it.cmdId).filter((id): id is string => Boolean(id)),
    [items],
  );

  // Shift-hover preview range
  const previewIds = useMemo<Set<string>>(() => {
    if (!shiftHeld || !hoverKey || !lastSelectedId) return new Set();
    const anchorIdx = items.findIndex((it) => it.cmdId === lastSelectedId);
    const hoverIdx = items.findIndex((it) => it.key === hoverKey);
    if (anchorIdx === -1 || hoverIdx === -1) return new Set();
    const [lo, hi] = anchorIdx < hoverIdx ? [anchorIdx, hoverIdx] : [hoverIdx, anchorIdx];
    return new Set(
      items.slice(lo, hi + 1).map((it) => it.cmdId).filter((id): id is string => Boolean(id)),
    );
  }, [shiftHeld, hoverKey, lastSelectedId, items]);

  // Scroll the first selected visible item into view
  useEffect(() => {
    if (selectedCommandIds.size === 0 || !containerRef.current) return;
    const firstItem = items.find((it) => it.cmdId && selectedCommandIds.has(it.cmdId));
    if (!firstItem?.cmdId) return;
    const el = containerRef.current.querySelector<HTMLElement>(`[data-id="${firstItem.cmdId}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedCommandIds, items]);

  const handleExpandToggle = useCallback((key: string) => {
    setExpandedKey((prev) => (prev === key ? null : key));
  }, []);

  const handleGroupToggle = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const handleRowClick = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      const mode: SelectMode =
        e.ctrlKey || e.metaKey ? 'toggle'
        : e.shiftKey           ? 'range'
        : 'single';
      onSelect(id, mode, allVisibleIds);
    },
    [onSelect, allVisibleIds],
  );

  if (commands.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
        No commands in this pattern
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-auto py-1 select-none"
      onClick={(e) => {
        // Click on the pane background clears selection
        if (e.target === e.currentTarget) onClear();
      }}
    >
      {items.map((item) => {
        const { cmdId } = item;
        const isSelected = Boolean(cmdId && selectedCommandIds.has(cmdId));
        const isPreview = Boolean(cmdId && previewIds.has(cmdId));
        const indent = item.depth * 16;

        const rowBg = isSelected
          ? 'bg-blue-600/40'
          : isPreview
          ? 'bg-blue-500/15'
          : 'hover:bg-gray-700/50';

        // ── Group header ──────────────────────────────────────────────────────
        if (item.isGroupHeader) {
          const group = item.cmd as GroupNode;
          return (
            <div key={item.key}>
              <div
                data-id={cmdId}
                onClick={(e) => {
                  if (cmdId) handleRowClick(e, cmdId);
                  handleGroupToggle(item.key);
                }}
                onContextMenu={(e) => {
                  if (cmdId && !selectedCommandIds.has(cmdId)) {
                    onSelect(cmdId, 'single', allVisibleIds);
                  }
                  onContextMenu?.(e, cmdId);
                }}
                onMouseEnter={() => setHoverKey(item.key)}
                onMouseLeave={() => setHoverKey(null)}
                className={`flex items-center gap-1.5 px-2 py-[3px] cursor-pointer rounded-sm text-xs ${rowBg}`}
              >
                <span className="text-gray-400 w-3 shrink-0 text-center">
                  {item.groupCollapsed ? '▸' : '▾'}
                </span>
                <span className="text-gray-100 font-bold">{group.name}</span>
                <span className="text-gray-500 ml-1">
                  ({group.commands.length} command{group.commands.length !== 1 ? 's' : ''})
                </span>
              </div>
            </div>
          );
        }

        const { cmd } = item;

        // ── Line / LineFix ────────────────────────────────────────────────────
        if (cmd.kind === 'Line') {
          const color = valveColor(cmd.valve);
          const kw = cmd.commandKeyword ?? 'Line';
          const isExpanded = expandedKey === item.key;
          const rawLines = isExpanded ? serializePatternCommand(cmd) : [];

          return (
            <div key={item.key} style={{ paddingLeft: indent }}>
              <div
                data-id={cmdId}
                onClick={(e) => {
                  if (cmdId) handleRowClick(e, cmdId);
                }}
                onContextMenu={(e) => {
                  if (cmdId && !selectedCommandIds.has(cmdId)) {
                    onSelect(cmdId, 'single', allVisibleIds);
                  }
                  onContextMenu?.(e, cmdId);
                }}
                onMouseEnter={() => setHoverKey(item.key)}
                onMouseLeave={() => setHoverKey(null)}
                className={[
                  'flex items-center gap-1 pr-2 py-[3px] cursor-pointer rounded-sm',
                  rowBg,
                  cmd.disabled ? 'opacity-50' : '',
                ].join(' ')}
              >
                <ChainConnector pos={item.chainPos} color={item.chainColor} />
                <span style={{ color }} className="font-mono font-bold text-xs w-6 shrink-0">
                  P{cmd.valve}
                </span>
                <span data-coord={`start:${cmdId}`} style={{ color }} className="font-mono text-[10px] shrink-0">
                  ({fmtPt(cmd.startPoint)})
                </span>
                <span className="text-gray-500 text-[10px] shrink-0">→</span>
                <span data-coord={`end:${cmdId}`} style={{ color }} className="font-mono text-[10px] shrink-0">
                  ({fmtPt(cmd.endPoint)})
                </span>
                <span className="text-gray-400 text-[10px] flex-1 min-w-0 truncate pl-1">
                  {cmd.flowRate.value.toFixed(4)} {cmd.flowRate.unit}
                </span>
                <span className="text-gray-600 font-mono text-[10px] shrink-0">{kw}</span>
                <span
                  onClick={(e) => { e.stopPropagation(); handleExpandToggle(item.key); }}
                  className="text-gray-500 hover:text-gray-300 text-[10px] shrink-0 ml-1 px-1 cursor-pointer"
                >
                  {isExpanded ? '▾' : '▸'}
                </span>
              </div>
              {isExpanded && (
                <div
                  className="mr-2 mb-0.5 rounded border border-gray-700 bg-gray-950 px-3 py-1.5 font-mono text-[10px] text-gray-400"
                  style={{ marginLeft: 20 }}
                >
                  {rawLines.map((line, li) => (
                    <div key={li} className="leading-relaxed">{line}</div>
                  ))}
                </div>
              )}
            </div>
          );
        }

        // ── Dot ───────────────────────────────────────────────────────────────
        if (cmd.kind === 'Dot') {
          const color = valveColor(cmd.valve);
          return (
            <div key={item.key} style={{ paddingLeft: indent }}>
              <div
                data-id={cmdId}
                onClick={(e) => { if (cmdId) handleRowClick(e, cmdId); }}
                onContextMenu={(e) => {
                  if (cmdId && !selectedCommandIds.has(cmdId)) {
                    onSelect(cmdId, 'single', allVisibleIds);
                  }
                  onContextMenu?.(e, cmdId);
                }}
                onMouseEnter={() => setHoverKey(item.key)}
                onMouseLeave={() => setHoverKey(null)}
                className={[
                  'flex items-center gap-1 pr-2 py-[3px] cursor-pointer rounded-sm',
                  rowBg,
                  cmd.disabled ? 'opacity-50' : '',
                ].join(' ')}
              >
                <div style={{ width: 16, flexShrink: 0 }} />
                <span style={{ color }} className="font-mono font-bold text-xs w-6 shrink-0">
                  P{cmd.valve}
                </span>
                <span data-coord={`dot:${cmdId}`} style={{ color }} className="font-mono text-[10px]">
                  ({fmtPt(cmd.point)})
                </span>
                <span className="text-gray-600 font-mono text-[10px] ml-auto shrink-0">Dot</span>
              </div>
            </div>
          );
        }

        // ── Comment ───────────────────────────────────────────────────────────
        if (cmd.kind === 'Comment') {
          return (
            <div key={item.key} style={{ paddingLeft: indent }}>
              <div
                data-id={cmdId}
                onClick={(e) => { if (cmdId) handleRowClick(e, cmdId); }}
                onContextMenu={(e) => {
                  if (cmdId && !selectedCommandIds.has(cmdId)) {
                    onSelect(cmdId, 'single', allVisibleIds);
                  }
                  onContextMenu?.(e, cmdId);
                }}
                className={`flex items-center gap-1 pr-2 py-[3px] rounded-sm cursor-pointer ${rowBg}`}
              >
                <div style={{ width: 16, flexShrink: 0 }} />
                <span className="font-mono text-[10px] text-green-500 truncate">
                  # {cmd.text}
                </span>
              </div>
            </div>
          );
        }

        // ── Mark / Laser ──────────────────────────────────────────────────────
        if (cmd.kind === 'Mark' || cmd.kind === 'Laser') {
          const preview = cmd.raw.length > 48 ? cmd.raw.slice(0, 48) + '…' : cmd.raw;
          return (
            <div key={item.key} style={{ paddingLeft: indent }}>
              <div
                data-id={cmdId}
                onClick={(e) => { if (cmdId) handleRowClick(e, cmdId); }}
                onContextMenu={(e) => {
                  if (cmdId && !selectedCommandIds.has(cmdId)) {
                    onSelect(cmdId, 'single', allVisibleIds);
                  }
                  onContextMenu?.(e, cmdId);
                }}
                className={`flex items-center gap-1.5 pr-2 py-[3px] rounded-sm cursor-pointer ${rowBg}`}
              >
                <div style={{ width: 16, flexShrink: 0 }} />
                <span className="font-mono text-[10px] text-gray-500 shrink-0">{cmd.kind}</span>
                <span className="font-mono text-[10px] text-gray-600 truncate">{preview}</span>
              </div>
            </div>
          );
        }

        // ── Raw fallback ──────────────────────────────────────────────────────
        if (cmd.kind === 'Raw') {
          const preview = cmd.raw.length > 60 ? cmd.raw.slice(0, 60) + '…' : cmd.raw;
          return (
            <div key={item.key} style={{ paddingLeft: indent }}>
              <div
                data-id={cmdId}
                onClick={(e) => { if (cmdId) handleRowClick(e, cmdId); }}
                onContextMenu={(e) => {
                  if (cmdId && !selectedCommandIds.has(cmdId)) {
                    onSelect(cmdId, 'single', allVisibleIds);
                  }
                  onContextMenu?.(e, cmdId);
                }}
                className={`flex items-center gap-1 pr-2 py-[3px] rounded-sm cursor-pointer ${rowBg}`}
              >
                <div style={{ width: 16, flexShrink: 0 }} />
                <span className="font-mono text-[10px] text-gray-600 italic truncate">{preview}</span>
              </div>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
