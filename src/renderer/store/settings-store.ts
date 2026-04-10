import { create } from 'zustand';
import type { SoftwareType } from '@lib/syntax-profiles';

export const DEFAULT_LINE_THICKNESS = 0.5; // mm
export const DEFAULT_DOT_SIZE       = 1.0; // mm diameter

interface SettingsStore {
  softwareType: SoftwareType;
  version: string;
  recentFiles: string[];
  loaded: boolean;
  /** Per-param (0-indexed) line stroke width in mm. Index 0 = Param 1. */
  lineThicknesses: number[];
  /** Per-param (0-indexed) dot diameter in mm. Index 0 = Param 1. */
  dotSizes: number[];

  init: () => Promise<void>;
  setSoftwareType: (type: SoftwareType) => Promise<void>;
  setVersion: (version: string) => Promise<void>;
  addRecentFile: (filePath: string) => Promise<void>;
  setLineThickness: (paramIndex: number, mm: number) => Promise<void>;
  setDotSize: (paramIndex: number, mm: number) => Promise<void>;
}

async function storeGet<T>(key: string, fallback: T): Promise<T> {
  const val = await window.electronAPI.storeGet(key);
  return val !== undefined && val !== null ? (val as T) : fallback;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  softwareType: 'MYD',
  version: '1.0',
  recentFiles: [],
  loaded: false,
  lineThicknesses: Array(10).fill(DEFAULT_LINE_THICKNESS),
  dotSizes: Array(10).fill(DEFAULT_DOT_SIZE),

  init: async () => {
    const softwareType    = await storeGet<SoftwareType>('softwareType', 'MYD');
    const version         = await storeGet<string>('version', '1.0');
    const recentFiles     = await storeGet<string[]>('recentFiles', []);
    const lineThicknesses = await storeGet<number[]>('lineThicknesses', Array(10).fill(DEFAULT_LINE_THICKNESS));
    const dotSizes        = await storeGet<number[]>('dotSizes', Array(10).fill(DEFAULT_DOT_SIZE));
    set({ softwareType, version, recentFiles, lineThicknesses, dotSizes, loaded: true });
  },

  setSoftwareType: async (softwareType: SoftwareType) => {
    await window.electronAPI.storeSet('softwareType', softwareType);
    set({ softwareType });
  },

  setVersion: async (version: string) => {
    await window.electronAPI.storeSet('version', version);
    set({ version });
  },

  addRecentFile: async (filePath: string) => {
    const updated = [filePath, ...get().recentFiles.filter((f) => f !== filePath)].slice(0, 10);
    await window.electronAPI.storeSet('recentFiles', updated);
    set({ recentFiles: updated });
  },

  setLineThickness: async (paramIndex: number, mm: number) => {
    const next = [...get().lineThicknesses];
    next[paramIndex] = Math.max(0.1, Math.min(5.0, mm));
    await window.electronAPI.storeSet('lineThicknesses', next);
    set({ lineThicknesses: next });
  },

  setDotSize: async (paramIndex: number, mm: number) => {
    const next = [...get().dotSizes];
    next[paramIndex] = Math.max(0.1, Math.min(10.0, mm));
    await window.electronAPI.storeSet('dotSizes', next);
    set({ dotSizes: next });
  },
}));
