import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PatternCommand, LineCommand, GroupNode, CommentCommand } from '@lib/types';
import { serializePatternCommand } from '@lib/serializer';
import { valveColor } from './visualization/renderers';
import { useUIStore } from '../store/ui-store';
import { useProgramStore } from '../store/program-store';
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  UniqueIdentifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

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
  /** True for synthetic ##GROUP/##ENDGROUP rows and for ## comment children — read-only, non-draggable. */
  isMetadata: boolean;
}

// ── Flat-item builder ─────────────────────────────────────────────────────────

function buildFlatItemsInner(
  commands: PatternCommand[],
  expandedGroups: Set<string>,
  depth: number,
  keyPrefix: string,
  items: FlatItem[],
): void {
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    const baseKey = keyPrefix ? `${keyPrefix}-${i}` : String(i);

    if (cmd.kind === 'Group') {
      const collapsed = !expandedGroups.has(baseKey);
      items.push({
        key: baseKey, cmdId: cmd.id, cmd, depth,
        isGroupHeader: true, groupCollapsed: collapsed,
        chainPos: null, chainColor: '', isMetadata: false,
      });
      if (!collapsed) {
        items.push({
          key: `${baseKey}-meta-open`, cmdId: undefined,
          cmd: { kind: 'Comment', text: `##GROUP:${cmd.name}` } as CommentCommand,
          depth: depth + 1, isGroupHeader: false, groupCollapsed: false,
          chainPos: null, chainColor: '', isMetadata: true,
        });
        buildFlatItemsInner(cmd.commands, expandedGroups, depth + 1, baseKey, items);
        items.push({
          key: `${baseKey}-meta-close`, cmdId: undefined,
          cmd: { kind: 'Comment', text: `##ENDGROUP:${cmd.name}` } as CommentCommand,
          depth: depth + 1, isGroupHeader: false, groupCollapsed: false,
          chainPos: null, chainColor: '', isMetadata: true,
        });
      }
    } else {
      const isChildMetadata = cmd.kind === 'Comment' && (cmd as CommentCommand).text.startsWith('##');
      items.push({
        key: baseKey, cmdId: cmd.id, cmd, depth,
        isGroupHeader: false, groupCollapsed: false,
        chainPos: null, chainColor: '', isMetadata: isChildMetadata,
      });
    }
  }
}

function buildFlatItems(
  commands: PatternCommand[],
  expandedGroups: Set<string>,
): FlatItem[] {
  const items: FlatItem[] = [];
  buildFlatItemsInner(commands, expandedGroups, 0, '', items);

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

// ── Sortable row wrapper ───────────────────────────────────────────────────────

function SortableRow({
  id,
  showTopIndicator,
  showBottomIndicator,
  children,
}: {
  id: string;
  showTopIndicator: boolean;
  showBottomIndicator: boolean;
  children: React.ReactNode;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, position: 'relative' }}
    >
      {showTopIndicator && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-400 z-20 pointer-events-none" />
      )}
      <div
        {...listeners}
        style={{ opacity: isDragging ? 0.25 : 1 }}
      >
        {children}
      </div>
      {showBottomIndicator && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-400 z-20 pointer-events-none" />
      )}
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
  onReorder?: (draggedIds: string[], insertBeforeId: string | null, targetGroupId: string | null) => void;
  /** Keys of groups the user has explicitly expanded. Managed by the parent so state survives pattern switching. */
  expandedGroups: Set<string>;
  setExpandedGroups: (updater: (prev: Set<string>) => Set<string>) => void;
}

export default function PatternCommandList({
  commands,
  selectedCommandIds,
  lastSelectedId,
  onSelect,
  onClear,
  onContextMenu,
  onReorder,
  expandedGroups,
  setExpandedGroups,
}: PatternCommandListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const renamingGroupId    = useUIStore((s) => s.renamingGroupId);
  const setRenamingGroupId = useUIStore((s) => s.setRenamingGroupId);
  const renameGroup        = useProgramStore((s) => s.renameGroup);

  const searchQuery         = useUIStore((s) => s.searchQuery);
  const searchMatchList     = useUIStore((s) => s.searchMatchList);
  const searchFocusedIdx    = useUIStore((s) => s.searchFocusedIdx);
  const selectedPatternName = useProgramStore((s) => s.selectedPatternName);

  // IDs that match in the currently displayed pattern
  const searchMatchIds = useMemo<Set<string> | null>(() => {
    if (!searchQuery.trim()) return null;
    return new Set(
      searchMatchList
        .filter((m) => m.patternName === null || m.patternName === selectedPatternName)
        .map((m) => m.id),
    );
  }, [searchQuery, searchMatchList, selectedPatternName]);

  // Group IDs whose subtree contains at least one match (used to avoid dimming group headers)
  const groupsWithChildMatches = useMemo<Set<string>>(() => {
    if (!searchMatchIds || searchMatchIds.size === 0) return new Set();
    const result = new Set<string>();
    function check(cmds: PatternCommand[]): boolean {
      let any = false;
      for (const c of cmds) {
        const self = Boolean(c.id && searchMatchIds!.has(c.id));
        if (c.kind === 'Group') {
          const childHit = check(c.commands);
          if ((self || childHit) && c.id) result.add(c.id);
          if (self || childHit) any = true;
        } else if (self) {
          any = true;
        }
      }
      return any;
    }
    check(commands);
    return result;
  }, [searchMatchIds, commands]);

  const searchFocusedId = searchMatchList[searchFocusedIdx]?.id ?? null;

  // When rename mode activates, seed the input with the current group name
  useEffect(() => {
    if (renamingGroupId === null) return;
    function findGroup(cmds: PatternCommand[]): GroupNode | null {
      for (const c of cmds) {
        if (c.kind === 'Group') {
          if (c.id === renamingGroupId) return c;
          const inner = findGroup(c.commands);
          if (inner) return inner;
        }
      }
      return null;
    }
    const group = findGroup(commands);
    if (group) setRenameValue(group.name);
  }, [renamingGroupId, commands]);

  // ── DnD state ──────────────────────────────────────────────────────────────
  const [dragActiveId, setDragActiveId] = useState<UniqueIdentifier | null>(null);
  const [dragOverId, setDragOverId] = useState<UniqueIdentifier | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Track shift key globally
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const items = useMemo(
    () => buildFlatItems(commands, expandedGroups),
    [commands, expandedGroups],
  );

  const sortableIds = useMemo(
    () => items.filter((it) => !it.isMetadata && it.depth <= 1).map((it) => it.key),
    [items],
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

  // Auto-expand group containing the focused search match, then scroll it into view
  useEffect(() => {
    if (!searchFocusedId) return;
    // Recursively find all ancestor group keys for the focused command
    function findAncestorKeys(cmds: PatternCommand[], targetId: string, prefix: string): string[] | null {
      for (let i = 0; i < cmds.length; i++) {
        const c = cmds[i];
        const key = prefix ? `${prefix}-${i}` : String(i);
        if (c.id === targetId) return [];
        if (c.kind === 'Group') {
          const inner = findAncestorKeys(c.commands, targetId, key);
          if (inner !== null) return [key, ...inner];
        }
      }
      return null;
    }
    const ancestorKeys = findAncestorKeys(commands, searchFocusedId, '');
    if (ancestorKeys && ancestorKeys.length > 0) {
      setExpandedGroups((prev) => {
        const toExpand = ancestorKeys.filter((k) => !prev.has(k));
        if (toExpand.length === 0) return prev;
        const next = new Set(prev);
        toExpand.forEach((k) => next.add(k));
        return next;
      });
    }
    // Scroll after a tick so the DOM has updated after any expand
    const t = setTimeout(() => {
      if (!containerRef.current) return;
      const el = containerRef.current.querySelector<HTMLElement>(`[data-id="${searchFocusedId}"]`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 50);
    return () => clearTimeout(t);
  }, [searchFocusedId, commands]);

  const handleExpandToggle = useCallback((key: string) => {
    setExpandedKey((prev) => (prev === key ? null : key));
  }, []);

  const handleGroupToggle = useCallback((key: string) => {
    setExpandedGroups((prev) => {
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

  // ── DnD handlers ───────────────────────────────────────────────────────────

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDragActiveId(event.active.id);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    setDragOverId(event.over?.id ?? null);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setDragActiveId(null);
    setDragOverId(null);

    if (!over || active.id === over.id || !onReorder) return;

    const activeIdx = items.findIndex((it) => it.key === String(active.id));
    const overIdx   = items.findIndex((it) => it.key === String(over.id));
    if (activeIdx === -1 || overIdx === -1) return;

    const activeItem = items[activeIdx];
    const overItem   = items[overIdx];
    if (!activeItem.cmdId) return;

    // Multi-select: move all selected items as a block
    const isMulti = selectedCommandIds.has(activeItem.cmdId) && selectedCommandIds.size > 1;
    const movedIds = isMulti
      ? items.filter((it) => it.cmdId && selectedCommandIds.has(it.cmdId)).map((it) => it.cmdId as string)
      : [activeItem.cmdId];

    const movingDown = activeIdx < overIdx;

    // Determine target container (group or top-level)
    let targetGroupId: string | null = null;
    if (overItem.depth === 1 && !overItem.isGroupHeader) {
      // Find the parent group header by searching backward
      for (let i = overIdx - 1; i >= 0; i--) {
        if (items[i].isGroupHeader) { targetGroupId = items[i].cmdId ?? null; break; }
      }
    }

    // Determine insertBeforeId based on drag direction
    let insertBeforeId: string | null = null;
    if (movingDown) {
      // Insert AFTER overItem — find next sibling in the same container
      for (let i = overIdx + 1; i < items.length; i++) {
        const it = items[i];
        if (targetGroupId !== null) {
          if (it.depth === 0) break; // exited the group
          insertBeforeId = it.cmdId ?? null;
          break;
        } else {
          if (it.depth === 0) { insertBeforeId = it.cmdId ?? null; break; }
        }
      }
      // insertBeforeId remains null → append to end of container
    } else {
      // Insert BEFORE overItem
      insertBeforeId = overItem.cmdId ?? null;
    }

    onReorder(movedIds, insertBeforeId, targetGroupId);
  }, [items, selectedCommandIds, onReorder]);

  // Drop indicator positions
  const dragActiveIdx = dragActiveId !== null ? items.findIndex((it) => it.key === String(dragActiveId)) : -1;
  const dragOverIdx   = dragOverId   !== null ? items.findIndex((it) => it.key === String(dragOverId))   : -1;
  const isDraggingDown = dragActiveIdx < dragOverIdx;

  if (commands.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
        No commands in this pattern
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        <div
          ref={containerRef}
          className="flex-1 overflow-auto py-1 select-none"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClear();
          }}
          onContextMenu={(e) => {
            if (e.target === e.currentTarget) {
              e.preventDefault();
              onContextMenu?.(e, undefined);
            }
          }}
        >
          {items.map((item, idx) => {
            const { cmdId } = item;
            const isSelected = Boolean(cmdId && selectedCommandIds.has(cmdId));
            const isPreview = Boolean(cmdId && previewIds.has(cmdId));
            const indent = item.depth * 16;

            const showTopIndicator    = dragOverIdx !== -1 && dragOverIdx === idx && !isDraggingDown;
            const showBottomIndicator = dragOverIdx !== -1 && dragOverIdx === idx && isDraggingDown;

            const isSearchActive = searchMatchIds !== null;
            const isMatch   = isSearchActive && Boolean(cmdId && searchMatchIds!.has(cmdId));
            const isFocused = isSearchActive && cmdId === searchFocusedId;
            // A group header is not dimmed if it or any descendant matches
            const notDimmed = !isSearchActive || isMatch || isFocused
              || Boolean(cmdId && groupsWithChildMatches.has(cmdId));

            const rowBg = isSelected
              ? 'bg-blue-600/40'
              : isFocused
              ? 'bg-amber-400/30'
              : isMatch
              ? 'bg-amber-400/10'
              : isPreview
              ? 'bg-blue-500/15'
              : 'hover:bg-gray-700/50';
            const dimStyle: React.CSSProperties = notDimmed ? {} : { opacity: 0.35 };

            // ── Metadata row (##GROUP:, ##ENDGROUP:, ##AREA_FILL_CONFIG:, etc.) ──
            if (item.isMetadata) {
              const metaText = item.cmd.kind === 'Comment' ? (item.cmd as CommentCommand).text : '';
              return (
                <div
                  key={item.key}
                  style={{ paddingLeft: indent }}
                  className="flex items-center gap-1.5 pr-2 py-[2px] pointer-events-none select-none"
                >
                  <div style={{ width: 16, flexShrink: 0 }} />
                  <span className="font-mono text-[9px] italic text-gray-600 opacity-60 truncate flex-1 min-w-0">
                    {metaText}
                  </span>
                  <span className="shrink-0 text-[8px] font-sans not-italic text-gray-700 bg-gray-800/60 border border-gray-700/50 rounded px-1 leading-none py-0.5">
                    meta
                  </span>
                </div>
              );
            }

            // ── Group header ────────────────────────────────────────────────
            if (item.isGroupHeader) {
              const group = item.cmd as GroupNode;
              // Depth-based left-border colours for nested groups
              const nestBorderColor = [
                'border-blue-500/60',
                'border-violet-500/60',
                'border-amber-500/60',
              ][(item.depth - 1) % 3];
              return (
                <SortableRow
                  key={item.key}
                  id={item.key}
                  showTopIndicator={showTopIndicator}
                  showBottomIndicator={showBottomIndicator}
                >
                  <div style={{ paddingLeft: indent }}>
                    <div
                      data-id={cmdId}
                      style={dimStyle}
                      onClick={(e) => {
                        if (renamingGroupId === cmdId) return;
                        if (cmdId) handleRowClick(e, cmdId);
                      }}
                      onDoubleClick={(e) => {
                        if (renamingGroupId === cmdId) return;
                        e.preventDefault();
                        handleGroupToggle(item.key);
                      }}
                      onContextMenu={(e) => {
                        if (cmdId && !selectedCommandIds.has(cmdId)) onSelect(cmdId, 'single', allVisibleIds);
                        onContextMenu?.(e, cmdId);
                      }}
                      onMouseEnter={() => setHoverKey(item.key)}
                      onMouseLeave={() => setHoverKey(null)}
                      className={[
                        'flex items-center gap-1.5 pr-2 py-[3px] cursor-pointer rounded-sm text-xs',
                        item.depth > 0
                          ? `pl-2 border-l-2 ${nestBorderColor}`
                          : 'px-2',
                        rowBg,
                        isFocused ? 'ring-1 ring-amber-400/60 ring-inset' : '',
                      ].filter(Boolean).join(' ')}
                    >
                      <span
                        onClick={(e) => { e.stopPropagation(); handleGroupToggle(item.key); }}
                        className="text-gray-400 w-3 shrink-0 text-center"
                      >
                        {item.groupCollapsed ? '▸' : '▾'}
                      </span>
                    {renamingGroupId === cmdId ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onFocus={(e) => e.target.select()}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const name = renameValue.trim();
                            if (name && cmdId) renameGroup(cmdId, name);
                            setRenamingGroupId(null);
                          } else if (e.key === 'Escape') {
                            setRenamingGroupId(null);
                          }
                          e.stopPropagation();
                        }}
                        onBlur={() => {
                          const name = renameValue.trim();
                          if (name && cmdId) renameGroup(cmdId, name);
                          setRenamingGroupId(null);
                        }}
                        className="bg-gray-800 border border-blue-500 rounded px-1 py-0 text-xs text-gray-100 font-bold outline-none min-w-0 flex-1"
                      />
                    ) : (
                      <span className="text-gray-100 font-bold">{group.name}</span>
                    )}
                    {renamingGroupId !== cmdId && (
                      <span className="text-gray-500 ml-1">
                        ({group.commands.length} command{group.commands.length !== 1 ? 's' : ''})
                      </span>
                    )}
                    </div>
                  </div>
                </SortableRow>
              );
            }

            const { cmd } = item;

            // ── Line ────────────────────────────────────────────────────────
            if (cmd.kind === 'Line') {
              const color = valveColor(cmd.valve);
              const kw = cmd.commandKeyword ?? 'Line';
              const isExpanded = expandedKey === item.key;
              const rawLines = isExpanded ? serializePatternCommand(cmd) : [];

              return (
                <SortableRow
                  key={item.key}
                  id={item.key}
                  showTopIndicator={showTopIndicator}
                  showBottomIndicator={showBottomIndicator}
                >
                  <div style={{ paddingLeft: indent, ...dimStyle }}>
                    <div
                      data-id={cmdId}
                      onClick={(e) => { if (cmdId) handleRowClick(e, cmdId); }}
                      onDoubleClick={(e) => { e.preventDefault(); handleExpandToggle(item.key); }}
                      onContextMenu={(e) => {
                        if (cmdId && !selectedCommandIds.has(cmdId)) onSelect(cmdId, 'single', allVisibleIds);
                        onContextMenu?.(e, cmdId);
                      }}
                      onMouseEnter={() => setHoverKey(item.key)}
                      onMouseLeave={() => setHoverKey(null)}
                      className={[
                        'flex items-center gap-1 pr-2 py-[3px] cursor-pointer rounded-sm',
                        rowBg,
                        cmd.disabled ? 'opacity-50' : '',
                        isFocused ? 'ring-1 ring-amber-400/60 ring-inset' : '',
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
                </SortableRow>
              );
            }

            // ── Dot ─────────────────────────────────────────────────────────
            if (cmd.kind === 'Dot') {
              const color = valveColor(cmd.valve);
              return (
                <SortableRow
                  key={item.key}
                  id={item.key}
                  showTopIndicator={showTopIndicator}
                  showBottomIndicator={showBottomIndicator}
                >
                  <div style={{ paddingLeft: indent, ...dimStyle }}>
                    <div
                      data-id={cmdId}
                      onClick={(e) => { if (cmdId) handleRowClick(e, cmdId); }}
                      onContextMenu={(e) => {
                        if (cmdId && !selectedCommandIds.has(cmdId)) onSelect(cmdId, 'single', allVisibleIds);
                        onContextMenu?.(e, cmdId);
                      }}
                      onMouseEnter={() => setHoverKey(item.key)}
                      onMouseLeave={() => setHoverKey(null)}
                      className={[
                        'flex items-center gap-1 pr-2 py-[3px] cursor-pointer rounded-sm',
                        rowBg,
                        cmd.disabled ? 'opacity-50' : '',
                        isFocused ? 'ring-1 ring-amber-400/60 ring-inset' : '',
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
                </SortableRow>
              );
            }

            // ── Comment ──────────────────────────────────────────────────────
            if (cmd.kind === 'Comment') {
              return (
                <SortableRow
                  key={item.key}
                  id={item.key}
                  showTopIndicator={showTopIndicator}
                  showBottomIndicator={showBottomIndicator}
                >
                  <div style={{ paddingLeft: indent, ...dimStyle }}>
                    <div
                      data-id={cmdId}
                      onClick={(e) => { if (cmdId) handleRowClick(e, cmdId); }}
                      onContextMenu={(e) => {
                        if (cmdId && !selectedCommandIds.has(cmdId)) onSelect(cmdId, 'single', allVisibleIds);
                        onContextMenu?.(e, cmdId);
                      }}
                      className={`flex items-center gap-1 pr-2 py-[3px] rounded-sm cursor-pointer ${rowBg}${isFocused ? ' ring-1 ring-amber-400/60 ring-inset' : ''}`}
                    >
                      <div style={{ width: 16, flexShrink: 0 }} />
                      <span className="font-mono text-[10px] text-green-500 truncate">
                        # {cmd.text}
                      </span>
                    </div>
                  </div>
                </SortableRow>
              );
            }

            // ── Mark / Laser ─────────────────────────────────────────────────
            if (cmd.kind === 'Mark' || cmd.kind === 'Laser') {
              const preview = cmd.raw.length > 48 ? cmd.raw.slice(0, 48) + '…' : cmd.raw;
              return (
                <SortableRow
                  key={item.key}
                  id={item.key}
                  showTopIndicator={showTopIndicator}
                  showBottomIndicator={showBottomIndicator}
                >
                  <div style={{ paddingLeft: indent, ...dimStyle }}>
                    <div
                      data-id={cmdId}
                      onClick={(e) => { if (cmdId) handleRowClick(e, cmdId); }}
                      onContextMenu={(e) => {
                        if (cmdId && !selectedCommandIds.has(cmdId)) onSelect(cmdId, 'single', allVisibleIds);
                        onContextMenu?.(e, cmdId);
                      }}
                      className={`flex items-center gap-1.5 pr-2 py-[3px] rounded-sm cursor-pointer ${rowBg}${isFocused ? ' ring-1 ring-amber-400/60 ring-inset' : ''}`}
                    >
                      <div style={{ width: 16, flexShrink: 0 }} />
                      <span className="font-mono text-[10px] text-gray-500 shrink-0">{cmd.kind}</span>
                      <span className="font-mono text-[10px] text-gray-600 truncate">{preview}</span>
                    </div>
                  </div>
                </SortableRow>
              );
            }

            // ── Raw fallback ─────────────────────────────────────────────────
            if (cmd.kind === 'Raw') {
              const preview = cmd.raw.length > 60 ? cmd.raw.slice(0, 60) + '…' : cmd.raw;
              return (
                <SortableRow
                  key={item.key}
                  id={item.key}
                  showTopIndicator={showTopIndicator}
                  showBottomIndicator={showBottomIndicator}
                >
                  <div style={{ paddingLeft: indent, ...dimStyle }}>
                    <div
                      data-id={cmdId}
                      onClick={(e) => { if (cmdId) handleRowClick(e, cmdId); }}
                      onContextMenu={(e) => {
                        if (cmdId && !selectedCommandIds.has(cmdId)) onSelect(cmdId, 'single', allVisibleIds);
                        onContextMenu?.(e, cmdId);
                      }}
                      className={`flex items-center gap-1 pr-2 py-[3px] rounded-sm cursor-pointer ${rowBg}${isFocused ? ' ring-1 ring-amber-400/60 ring-inset' : ''}`}
                    >
                      <div style={{ width: 16, flexShrink: 0 }} />
                      <span className="font-mono text-[10px] text-gray-600 italic truncate">{preview}</span>
                    </div>
                  </div>
                </SortableRow>
              );
            }

            return null;
          })}
        </div>
      </SortableContext>

      {/* Drag overlay — ghost that follows the cursor */}
      <DragOverlay dropAnimation={null}>
        {dragActiveId !== null ? (() => {
          const dragItem = items.find((it) => it.key === String(dragActiveId));
          const isMulti = dragItem?.cmdId && selectedCommandIds.has(dragItem.cmdId) && selectedCommandIds.size > 1;
          const label = isMulti
            ? `${selectedCommandIds.size} commands`
            : dragItem?.cmd.kind ?? 'Item';
          return (
            <div className="bg-gray-800 border border-blue-400/50 rounded shadow-2xl px-3 py-1.5 text-xs text-gray-200 opacity-90 pointer-events-none">
              {label}
            </div>
          );
        })() : null}
      </DragOverlay>
    </DndContext>
  );
}
