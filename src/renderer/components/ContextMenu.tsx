import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUIStore } from '../store/ui-store';
import { useProgramStore } from '../store/program-store';
import type { ContextMenuItem, ContextMenuState } from '../store/ui-store';
import type { PatternCommand, GroupNode } from '@lib/types';

export type { ContextMenuItem, ContextMenuState };

// ── Area fill / contour fill detection ───────────────────────────────────────

const AREA_FILL_PREFIX    = '##AREA_FILL_CONFIG:';
const CONTOUR_FILL_PREFIX = '##CONTOUR_FILL_CONFIG:';

function findAreaFillGroup(
  commands: PatternCommand[],
  ids: Set<string>,
): GroupNode | null {
  for (const c of commands) {
    if (
      c.kind === 'Group' &&
      c.id &&
      ids.has(c.id) &&
      c.commands.some((child) => child.kind === 'Comment' && child.text.startsWith(AREA_FILL_PREFIX))
    ) {
      return c;
    }
  }
  return null;
}

function findContourFillGroup(
  commands: PatternCommand[],
  ids: Set<string>,
): GroupNode | null {
  for (const c of commands) {
    if (
      c.kind === 'Group' &&
      c.id &&
      ids.has(c.id) &&
      c.commands.some((child) => child.kind === 'Comment' && child.text.startsWith(CONTOUR_FILL_PREFIX))
    ) {
      return c;
    }
  }
  return null;
}

function hasAnyGroup(commands: PatternCommand[]): boolean {
  return commands.some((c) => c.kind === 'Group');
}

/** Returns true if any group (at any nesting depth) is not collapsed. */
function hasAnyExpandedGroup(): boolean {
  return useUIStore.getState().hasExpandedGroups;
}

function findSingleGroup(
  commands: PatternCommand[],
  ids: Set<string>,
): GroupNode | null {
  if (ids.size !== 1) return null;
  const [id] = ids;
  for (const c of commands) {
    if (c.kind === 'Group' && c.id === id) return c;
  }
  return null;
}

// ── Icon components ───────────────────────────────────────────────────────────

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="1" width="8" height="10" rx="1.2" />
      <rect x="1" y="4" width="8" height="10" rx="1.2" fill="none" />
    </svg>
  );
}

function CutIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="3.5" cy="11" r="2" />
      <circle cx="10.5" cy="11" r="2" />
      <line x1="3.5" y1="9" x2="7" y2="5" />
      <line x1="10.5" y1="9" x2="7" y2="5" />
      <line x1="7" y1="5" x2="7" y2="1" />
    </svg>
  );
}

function PasteIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="10" height="9" rx="1.2" />
      <path d="M5 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" />
      <line x1="5" y1="7.5" x2="9" y2="7.5" />
      <line x1="5" y1="10" x2="9" y2="10" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="2,4 12,4" />
      <path d="M5 4V2.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5V4" />
      <rect x="3" y="4" width="8" height="8.5" rx="1" />
      <line x1="6" y1="6.5" x2="6" y2="10" />
      <line x1="8" y1="6.5" x2="8" y2="10" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2.5 L11.5 4.5 L5 11 L2 12 L3 9 Z" />
      <line x1="8" y1="4" x2="10" y2="6" />
    </svg>
  );
}

function ExpandAllIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      {/* top folder open */}
      <path d="M1 3.5Q1 3 1.5 3L4 3L5 4.5L8.5 4.5Q9 4.5 9 5L9 7" />
      {/* bottom folder open */}
      <path d="M5 7.5Q5 7 5.5 7L8 7L9 8.5L12.5 8.5Q13 8.5 13 9L13 12Q13 12.5 12.5 12.5L5.5 12.5Q5 12.5 5 12Z" />
      {/* expand arrow */}
      <polyline points="11,5 13,7 11,9" />
    </svg>
  );
}

function CollapseAllIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      {/* folder body */}
      <path d="M1 4Q1 3.5 1.5 3.5L4.5 3.5L5.5 5L12.5 5Q13 5 13 5.5L13 11Q13 11.5 12.5 11.5L1.5 11.5Q1 11.5 1 11Z" />
      {/* collapse chevrons pointing inward */}
      <polyline points="5,8 7,7 9,8" />
    </svg>
  );
}

const ICON_MAP: Record<NonNullable<ContextMenuItem['icon']>, React.FC> = {
  copy:         CopyIcon,
  cut:          CutIcon,
  paste:        PasteIcon,
  delete:       DeleteIcon,
  edit:         EditIcon,
  'expand-all':   ExpandAllIcon,
  'collapse-all': CollapseAllIcon,
};

// ── Menu row ──────────────────────────────────────────────────────────────────

function MenuRow({ item }: { item: ContextMenuItem }) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const rowRef = useRef<HTMLButtonElement>(null);
  const IconComp = item.icon ? ICON_MAP[item.icon] : null;

  const handleClick = () => {
    if (!item.disabled && item.action) item.action();
  };

  return (
    <div className="relative">
      <button
        ref={rowRef}
        onClick={handleClick}
        onMouseEnter={() => { if (item.disabled && item.disabledReason) setTooltipVisible(true); }}
        onMouseLeave={() => setTooltipVisible(false)}
        className={[
          'flex items-center gap-2 w-full text-left px-2.5 h-[28px] text-xs rounded-sm transition-colors',
          item.disabled
            ? 'text-gray-600 cursor-default'
            : 'text-gray-200 hover:bg-gray-700 cursor-pointer',
        ].join(' ')}
      >
        <span className={`w-4 shrink-0 flex items-center justify-center ${item.disabled ? 'text-gray-600' : 'text-gray-400'}`}>
          {IconComp && <IconComp />}
        </span>
        <span className="flex-1">{item.label}</span>
        {item.shortcut && (
          <span className={`text-[10px] font-mono ${item.disabled ? 'text-gray-700' : 'text-gray-500'}`}>
            {item.shortcut}
          </span>
        )}
      </button>

      {tooltipVisible && item.disabledReason && (
        <div
          className="absolute left-full top-1/2 -translate-y-1/2 ml-2 z-[10000] max-w-[220px] bg-gray-950 border border-gray-600 text-gray-300 text-[11px] rounded px-2 py-1.5 leading-snug shadow-xl pointer-events-none whitespace-normal"
        >
          {item.disabledReason}
        </div>
      )}
    </div>
  );
}

// ── Context menu component ────────────────────────────────────────────────────

export default function ContextMenu() {
  const contextMenu = useUIStore((s) => s.contextMenu);
  const hideContextMenu = useUIStore((s) => s.hideContextMenu);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside mousedown
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        hideContextMenu();
      }
    };
    window.addEventListener('mousedown', handler, true);
    return () => window.removeEventListener('mousedown', handler, true);
  }, [contextMenu, hideContextMenu]);

  // Close on Escape
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hideContextMenu();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [contextMenu, hideContextMenu]);

  if (!contextMenu) return null;

  // Clamp position to stay within viewport (conservative estimate)
  const estW = 220;
  const estH = contextMenu.items.length * 30 + 8;
  const x = Math.min(contextMenu.x, window.innerWidth - estW - 4);
  const y = Math.min(contextMenu.y, window.innerHeight - estH - 4);

  return createPortal(
    <div
      ref={menuRef}
      onMouseDown={(e) => e.stopPropagation()}
      style={{ position: 'fixed', left: x, top: y, zIndex: 9999 }}
      className="bg-gray-900 border border-gray-700 rounded-md shadow-2xl py-1 min-w-[190px]"
    >
      {contextMenu.items.map((item, i) =>
        item.separator ? (
          <div key={i} className="my-1 border-t border-gray-700/80" />
        ) : (
          <MenuRow key={i} item={item} />
        ),
      )}
    </div>,
    document.body,
  );
}

// ── Hook: build and show a context menu for the current selection ─────────────

/**
 * Returns a `showMenu(x, y, commands)` function that builds the context menu
 * for the current selection and shows it at the given screen position.
 * Pass `commands` so area-fill group detection works.
 */
export function useCommandContextMenu() {
  const showContextMenu = useUIStore((s) => s.showContextMenu);
  const hideContextMenu = useUIStore((s) => s.hideContextMenu);

  const showMenu = useCallback(
    (x: number, y: number, commands: PatternCommand[]) => {
      const {
        selectedCommandIds,
        clipboard,
        copySelection,
        cutSelection,
        pasteAboveSelection,
        deleteSelection,
      } = useProgramStore.getState();
      const { setActiveTool, setAreaFillEditGroupId } = useUIStore.getState();

      const hasSelection = selectedCommandIds.size > 0;
      const hasClipboard = Boolean(clipboard && clipboard.length > 0);
      const canPaste = hasClipboard && hasSelection;
      const pasteReason = !hasClipboard
        ? 'Nothing in clipboard'
        : 'Select a command first — pasted commands will be inserted above the selection.';

      const areaFillGroup = hasSelection
        ? findAreaFillGroup(commands, selectedCommandIds)
        : null;
      const contourFillGroup = hasSelection
        ? findContourFillGroup(commands, selectedCommandIds)
        : null;
      const singleGroup = hasSelection
        ? findSingleGroup(commands, selectedCommandIds)
        : null;

      const n = selectedCommandIds.size;
      const items: ContextMenuItem[] = [
        {
          label: 'Copy',
          icon: 'copy',
          shortcut: 'Ctrl+C',
          action: () => { copySelection(); hideContextMenu(); },
        },
        {
          label: 'Cut',
          icon: 'cut',
          shortcut: 'Ctrl+X',
          action: () => { cutSelection(); hideContextMenu(); },
        },
        {
          label: 'Paste',
          icon: 'paste',
          shortcut: 'Ctrl+V',
          disabled: !canPaste,
          disabledReason: canPaste ? undefined : pasteReason,
          action: () => { pasteAboveSelection(); hideContextMenu(); },
        },
        { separator: true },
        {
          label: n > 1 ? `Delete (${n})` : 'Delete',
          icon: 'delete',
          shortcut: 'Del',
          action: () => { deleteSelection(); hideContextMenu(); },
        },
      ];

      if (singleGroup) {
        items.push({ separator: true });
        if (!areaFillGroup && !contourFillGroup) {
          items.push({
            label: 'Rename Group',
            icon: 'edit',
            action: () => {
              useUIStore.getState().setRenamingGroupId(singleGroup.id!);
              hideContextMenu();
            },
          });
        }
        if (areaFillGroup) {
          items.push({
            label: 'Edit Area Fill',
            icon: 'edit',
            action: () => {
              setAreaFillEditGroupId(areaFillGroup.id!);
              setActiveTool('area-fill');
              hideContextMenu();
            },
          });
        }
        if (contourFillGroup) {
          items.push({
            label: 'Edit Contour Fill',
            icon: 'edit',
            action: () => {
              useUIStore.getState().setContourFillEditGroupId(contourFillGroup.id!);
              setActiveTool('contour-fill');
              hideContextMenu();
            },
          });
        }
      } else if (areaFillGroup) {
        items.push({ separator: true });
        items.push({
          label: 'Edit Area Fill',
          icon: 'edit',
          action: () => {
            setAreaFillEditGroupId(areaFillGroup.id!);
            setActiveTool('area-fill');
            hideContextMenu();
          },
        });
      } else if (contourFillGroup) {
        items.push({ separator: true });
        items.push({
          label: 'Edit Contour Fill',
          icon: 'edit',
          action: () => {
            useUIStore.getState().setContourFillEditGroupId(contourFillGroup.id!);
            setActiveTool('contour-fill');
            hideContextMenu();
          },
        });
      }

      // Expand / Collapse all groups — only shown when groups exist
      if (hasAnyGroup(commands)) {
        const anyExpanded = hasAnyExpandedGroup();
        items.push({ separator: true });
        items.push({
          label: 'Expand All Groups',
          icon: 'expand-all',
          action: () => { useUIStore.getState().triggerExpandAll(); hideContextMenu(); },
        });
        if (anyExpanded) {
          items.push({
            label: 'Collapse All Groups',
            icon: 'collapse-all',
            action: () => { useUIStore.getState().triggerCollapseAll(); hideContextMenu(); },
          });
        }
      }

      showContextMenu({ x, y, items });
    },
    [showContextMenu, hideContextMenu],
  );

  /** Show a Paste-only menu (for right-clicking empty canvas when clipboard has items). */
  const showPasteOnlyMenu = useCallback(
    (x: number, y: number) => {
      const { clipboard, pasteAboveSelection } = useProgramStore.getState();
      if (!clipboard || clipboard.length === 0) return;
      showContextMenu({
        x, y,
        items: [
          {
            label: 'Paste',
            icon: 'paste',
            shortcut: 'Ctrl+V',
            disabled: true,
            disabledReason: 'Select a command first — pasted commands will be inserted above the selection.',
            action: () => { pasteAboveSelection(); hideContextMenu(); },
          },
        ],
      });
    },
    [showContextMenu, hideContextMenu],
  );

  return { showMenu, showPasteOnlyMenu };
}
