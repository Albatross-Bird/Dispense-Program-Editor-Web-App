import { create } from 'zustand';
import type { PatternCommand } from '@lib/types';
import type { SearchScope, SearchMatch } from '@lib/search';
import type { CalibPoint } from '@lib/affine';

const SPLIT_KEY = 'splitRatio';

function getInitialSplit(): number {
  const stored = localStorage.getItem(SPLIT_KEY);
  if (stored) {
    const v = parseFloat(stored);
    if (!isNaN(v) && v >= 0.1 && v <= 0.9) return v;
  }
  return 0.5;
}

export interface BackgroundImage {
  filePath: string;
  dataUrl: string;
}

export type ActiveTool = 'new-line' | 'new-dot' | 'new-comment' | 'area-fill' | 'contour-fill' | 'split-line' | 'join-lines' | 'delete-item' | null;

export interface ContextMenuItem {
  label?: string;
  icon?: 'copy' | 'cut' | 'paste' | 'delete' | 'edit' | 'expand-all' | 'collapse-all';
  shortcut?: string;
  disabled?: boolean;
  disabledReason?: string;
  separator?: boolean;
  action?: () => void;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface UIStore {
  splitRatio: number;
  zoomLevel: number;
  panOffset: { x: number; y: number };
  cursorCoords: { x: number; y: number } | null;
  /** Per-pattern background images. Key = `${filePath}::${patternName}`. */
  backgroundImages: Record<string, BackgroundImage>;
  activeTool: ActiveTool;

  /** Area-fill polygon state (world-space vertices). */
  areaFillPolygon: [number, number][];
  /** True once the polygon has been closed by the user. */
  areaFillClosed: boolean;
  /** Live preview commands generated from current config (empty = no preview). */
  areaFillPreviewCmds: PatternCommand[];
  /** When non-null, the area-fill panel is editing an existing group rather than creating a new one. */
  areaFillEditGroupId: string | null;

  /** Contour-fill polygon state (world-space vertices). */
  contourFillPolygon: [number, number][];
  /** True once the contour-fill polygon has been closed by the user. */
  contourFillClosed: boolean;
  /** Live preview commands for contour fill (empty = no preview). */
  contourFillPreviewCmds: PatternCommand[];
  /** When non-null, the contour-fill panel is editing an existing group. */
  contourFillEditGroupId: string | null;

  /** Incremented each time the status-bar zoom is clicked; Canvas watches this to fit-to-view. */
  fitToViewTrigger: number;
  triggerFitToView: () => void;

  /** Incremented to request expanding all groups in the current pattern. */
  expandAllTrigger: number;
  triggerExpandAll: () => void;
  /** Incremented to request collapsing all groups in the current pattern. */
  collapseAllTrigger: number;
  triggerCollapseAll: () => void;

  setSplitRatio: (ratio: number) => void;
  setZoomLevel: (zoom: number) => void;
  setPanOffset: (offset: { x: number; y: number }) => void;
  setCursorCoords: (coords: { x: number; y: number } | null) => void;
  setBackgroundImage: (patternKey: string, img: BackgroundImage | null) => void;
  historyPanelOpen: boolean;
  setHistoryPanelOpen: (open: boolean) => void;

  setActiveTool: (tool: ActiveTool) => void;
  setAreaFillPolygon: (verts: [number, number][]) => void;
  setAreaFillClosed: (closed: boolean) => void;
  setAreaFillPreviewCmds: (cmds: PatternCommand[]) => void;
  setAreaFillEditGroupId: (id: string | null) => void;
  clearAreaFill: () => void;

  setContourFillPolygon: (verts: [number, number][]) => void;
  setContourFillClosed: (closed: boolean) => void;
  setContourFillPreviewCmds: (cmds: PatternCommand[]) => void;
  setContourFillEditGroupId: (id: string | null) => void;
  clearContourFill: () => void;

  contextMenu: ContextMenuState | null;
  showContextMenu: (state: ContextMenuState) => void;
  hideContextMenu: () => void;

  /** The valve/param number (1–10) to assign to newly created Line/Dot commands. */
  activeParam: number;
  setActiveParam: (n: number) => void;

  /** ID of the Group currently being renamed inline in the command list, or null. */
  renamingGroupId: string | null;
  setRenamingGroupId: (id: string | null) => void;

  // ── Layers panel position ────────────────────────────────────────────────────
  /** Per-patternKey layers panel position. Key = `${filePath}::${patternName}`. */
  layersPanelPositions: Record<string, { x: number; y: number }>;
  setLayersPanelPosition: (key: string, pos: { x: number; y: number }) => void;

  // ── Search ──────────────────────────────────────────────────────────────────
  searchQuery: string;
  searchScope: SearchScope;
  /** Ordered list of all matches across the searched scope. */
  searchMatchList: SearchMatch[];
  /** Index into searchMatchList for the currently focused/navigated match. */
  searchFocusedIdx: number;
  setSearchQuery: (q: string) => void;
  setSearchScope: (s: SearchScope) => void;
  setSearchResults: (list: SearchMatch[]) => void;
  /** Advance (+1) or retreat (−1) through the match list, wrapping around. */
  stepSearchFocus: (dir: 1 | -1) => void;
  clearSearch: () => void;

  // ── New-line chain mode ──────────────────────────────────────────────────────
  /** When true, successive New Line placements share endpoints (chained). */
  chainMode: boolean;
  setChainMode: (v: boolean) => void;

  // ── New-comment tool ─────────────────────────────────────────────────────────
  /** Text currently typed in the comment tool's floating input. */
  pendingCommentText: string;
  setPendingCommentText: (text: string) => void;

  // ── Pending background images ─────────────────────────────────────────────
  /**
   * Patterns that have a `##BG_IMAGE:` metadata comment stored in their commands.
   * Key = `${filePath}::${patternName}`. Value = parsed image path + calibration points.
   * The image is NOT loaded into memory until the user explicitly enables it.
   */
  pendingBgImages: Record<string, { filePath: string; points: CalibPoint[] }>;
  setPendingBgImage: (key: string, data: { filePath: string; points: CalibPoint[] } | null) => void;

  // ── Plain text mode ──────────────────────────────────────────────────────────
  plainTextMode: boolean;
  setPlainTextMode: (v: boolean) => void;
  /** Parse status of the plain-text editor. 'idle' = not yet parsed / typing. */
  plainTextParseStatus: 'idle' | 'valid' | 'error';
  plainTextParseError: string | null;
  setPlainTextParseStatus: (status: 'idle' | 'valid' | 'error', error?: string | null) => void;
}

export const useUIStore = create<UIStore>((set, get) => ({
  splitRatio: getInitialSplit(),
  zoomLevel: 1,
  fitToViewTrigger: 0,
  triggerFitToView: () => set((s) => ({ fitToViewTrigger: s.fitToViewTrigger + 1 })),
  expandAllTrigger: 0,
  triggerExpandAll: () => set((s) => ({ expandAllTrigger: s.expandAllTrigger + 1 })),
  collapseAllTrigger: 0,
  triggerCollapseAll: () => set((s) => ({ collapseAllTrigger: s.collapseAllTrigger + 1 })),
  panOffset: { x: 0, y: 0 },
  cursorCoords: null,
  backgroundImages: {},
  activeTool: null,
  historyPanelOpen: false,
  areaFillPolygon: [],
  areaFillClosed: false,
  areaFillPreviewCmds: [],
  areaFillEditGroupId: null,
  contourFillPolygon: [],
  contourFillClosed: false,
  contourFillPreviewCmds: [],
  contourFillEditGroupId: null,
  contextMenu: null,

  setSplitRatio: (ratio: number) => {
    localStorage.setItem(SPLIT_KEY, String(ratio));
    set({ splitRatio: ratio });
  },
  setZoomLevel: (zoomLevel: number) => set({ zoomLevel }),
  setPanOffset: (panOffset: { x: number; y: number }) => set({ panOffset }),
  setCursorCoords: (cursorCoords: { x: number; y: number } | null) => set({ cursorCoords }),
  setBackgroundImage: (patternKey: string, img: BackgroundImage | null) => {
    const { [patternKey]: _removed, ...rest } = get().backgroundImages;
    set({ backgroundImages: img ? { ...rest, [patternKey]: img } : rest });
  },
  setHistoryPanelOpen: (historyPanelOpen: boolean) => set({ historyPanelOpen }),
  setActiveTool: (activeTool: ActiveTool) => set({ activeTool }),
  setAreaFillPolygon: (areaFillPolygon: [number, number][]) => set({ areaFillPolygon }),
  setAreaFillClosed: (areaFillClosed: boolean) => set({ areaFillClosed }),
  setAreaFillPreviewCmds: (areaFillPreviewCmds: PatternCommand[]) => set({ areaFillPreviewCmds }),
  setAreaFillEditGroupId: (areaFillEditGroupId: string | null) => set({ areaFillEditGroupId }),
  clearAreaFill: () => set({ areaFillPolygon: [], areaFillClosed: false, areaFillPreviewCmds: [], areaFillEditGroupId: null }),

  setContourFillPolygon: (contourFillPolygon: [number, number][]) => set({ contourFillPolygon }),
  setContourFillClosed: (contourFillClosed: boolean) => set({ contourFillClosed }),
  setContourFillPreviewCmds: (contourFillPreviewCmds: PatternCommand[]) => set({ contourFillPreviewCmds }),
  setContourFillEditGroupId: (contourFillEditGroupId: string | null) => set({ contourFillEditGroupId }),
  clearContourFill: () => set({ contourFillPolygon: [], contourFillClosed: false, contourFillPreviewCmds: [], contourFillEditGroupId: null }),

  showContextMenu: (state: ContextMenuState) => set({ contextMenu: state }),
  hideContextMenu: () => set({ contextMenu: null }),

  activeParam: 1,
  setActiveParam: (activeParam: number) => set({ activeParam }),

  renamingGroupId: null,
  setRenamingGroupId: (renamingGroupId: string | null) => set({ renamingGroupId }),

  layersPanelPositions: {},
  setLayersPanelPosition: (key, pos) =>
    set((s) => ({ layersPanelPositions: { ...s.layersPanelPositions, [key]: pos } })),

  searchQuery: '',
  searchScope: 'pattern' as SearchScope,
  searchMatchList: [],
  searchFocusedIdx: 0,
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSearchScope: (searchScope) => set({ searchScope }),
  setSearchResults: (searchMatchList) => set({ searchMatchList, searchFocusedIdx: 0 }),
  stepSearchFocus: (dir) => set((s) => {
    const n = s.searchMatchList.length;
    if (n === 0) return {};
    return { searchFocusedIdx: ((s.searchFocusedIdx + dir) % n + n) % n };
  }),
  clearSearch: () => set({ searchQuery: '', searchMatchList: [], searchFocusedIdx: 0 }),

  pendingBgImages: {},
  setPendingBgImage: (key, data) => set((s) => {
    if (data === null) {
      const { [key]: _removed, ...rest } = s.pendingBgImages;
      return { pendingBgImages: rest };
    }
    return { pendingBgImages: { ...s.pendingBgImages, [key]: data } };
  }),

  chainMode: false,
  setChainMode: (chainMode: boolean) => set({ chainMode }),
  pendingCommentText: '',
  setPendingCommentText: (pendingCommentText: string) => set({ pendingCommentText }),

  plainTextMode: false,
  setPlainTextMode: (plainTextMode: boolean) => set({ plainTextMode }),
  plainTextParseStatus: 'idle',
  plainTextParseError: null,
  setPlainTextParseStatus: (status, error = null) => set({ plainTextParseStatus: status, plainTextParseError: error ?? null }),
}));
