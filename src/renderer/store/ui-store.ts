import { create } from 'zustand';
import type { PatternCommand } from '@lib/types';

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

export type ActiveTool = 'new-line' | 'new-dot' | 'area-fill' | null;

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
}

export const useUIStore = create<UIStore>((set, get) => ({
  splitRatio: getInitialSplit(),
  zoomLevel: 1,
  panOffset: { x: 0, y: 0 },
  cursorCoords: null,
  backgroundImages: {},
  activeTool: null,
  historyPanelOpen: false,
  areaFillPolygon: [],
  areaFillClosed: false,
  areaFillPreviewCmds: [],
  areaFillEditGroupId: null,

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
}));
