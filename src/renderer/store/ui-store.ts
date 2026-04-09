import { create } from 'zustand';

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

export type ActiveTool = 'new-line' | 'new-dot' | null;

interface UIStore {
  splitRatio: number;
  zoomLevel: number;
  panOffset: { x: number; y: number };
  cursorCoords: { x: number; y: number } | null;
  /** Per-pattern background images. Key = `${filePath}::${patternName}`. */
  backgroundImages: Record<string, BackgroundImage>;
  activeTool: ActiveTool;

  setSplitRatio: (ratio: number) => void;
  setZoomLevel: (zoom: number) => void;
  setPanOffset: (offset: { x: number; y: number }) => void;
  setCursorCoords: (coords: { x: number; y: number } | null) => void;
  setBackgroundImage: (patternKey: string, img: BackgroundImage | null) => void;
  setActiveTool: (tool: ActiveTool) => void;
}

export const useUIStore = create<UIStore>((set, get) => ({
  splitRatio: getInitialSplit(),
  zoomLevel: 1,
  panOffset: { x: 0, y: 0 },
  cursorCoords: null,
  backgroundImages: {},
  activeTool: null,

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
  setActiveTool: (activeTool: ActiveTool) => set({ activeTool }),
}));
