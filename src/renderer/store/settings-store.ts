import { create } from 'zustand';
import type { SoftwareType } from '@lib/syntax-profiles';
import type { Lang } from '@lib/i18n';

export const DEFAULT_LINE_THICKNESS = 0.5; // mm
export const DEFAULT_DOT_SIZE       = 1.0; // mm diameter

// ── Background image settings ─────────────────────────────────────────────────

export interface BgImageSettings {
  grayscale: boolean;
  /** Render resolution as a percentage of original (10–100). Reduces quality for perf. */
  resolutionScale: number;
  /** -100 to +100, maps to CSS brightness 0–2 */
  brightness: number;
  /** -100 to +100, maps to CSS contrast 0–2 */
  contrast: number;
  threshold: boolean;
  /** 0–255 luminance threshold value */
  thresholdValue: number;
  /** 0–10, maps to 0–5px CSS blur radius */
  smoothing: number;
}

export const DEFAULT_BG_IMAGE_SETTINGS: BgImageSettings = {
  grayscale: false,
  resolutionScale: 100,
  brightness: 0,
  contrast: 0,
  threshold: false,
  thresholdValue: 128,
  smoothing: 0,
};

// ── Store interface ───────────────────────────────────────────────────────────

interface SettingsStore {
  softwareType: SoftwareType;
  version: string;
  language: Lang;
  recentFiles: string[];
  loaded: boolean;
  /** Per-param (0-indexed) line stroke width in mm. Index 0 = Param 1. */
  lineThicknesses: number[];
  /** Per-param (0-indexed) dot diameter in mm. Index 0 = Param 1. */
  dotSizes: number[];
  /** Per-file background image display settings. Key = absolute file path. */
  bgImageSettings: Record<string, BgImageSettings>;

  init: () => Promise<void>;
  setSoftwareType: (type: SoftwareType) => Promise<void>;
  setVersion: (version: string) => Promise<void>;
  setLanguage: (lang: Lang) => Promise<void>;
  addRecentFile: (filePath: string) => Promise<void>;
  setLineThickness: (paramIndex: number, mm: number) => Promise<void>;
  setDotSize: (paramIndex: number, mm: number) => Promise<void>;
  getBgImageSettings: (filePath: string) => BgImageSettings;
  setBgImageSettings: (filePath: string, settings: BgImageSettings) => Promise<void>;
}

async function storeGet<T>(key: string, fallback: T): Promise<T> {
  const val = await window.electronAPI.storeGet(key);
  return val !== undefined && val !== null ? (val as T) : fallback;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  softwareType: 'MYD',
  version: '1.0',
  language: 'en',
  recentFiles: [],
  loaded: false,
  lineThicknesses: Array(10).fill(DEFAULT_LINE_THICKNESS),
  dotSizes: Array(10).fill(DEFAULT_DOT_SIZE),
  bgImageSettings: {},

  init: async () => {
    const softwareType    = await storeGet<SoftwareType>('softwareType', 'MYD');
    const version         = await storeGet<string>('version', '1.0');
    const language        = await storeGet<Lang>('language', 'en');
    const recentFiles     = await storeGet<string[]>('recentFiles', []);
    const lineThicknesses = await storeGet<number[]>('lineThicknesses', Array(10).fill(DEFAULT_LINE_THICKNESS));
    const dotSizes        = await storeGet<number[]>('dotSizes', Array(10).fill(DEFAULT_DOT_SIZE));
    const bgImageSettings = await storeGet<Record<string, BgImageSettings>>('bgImageSettings', {});
    set({ softwareType, version, language, recentFiles, lineThicknesses, dotSizes, bgImageSettings, loaded: true });
  },

  setSoftwareType: async (softwareType: SoftwareType) => {
    await window.electronAPI.storeSet('softwareType', softwareType);
    set({ softwareType });
  },

  setVersion: async (version: string) => {
    await window.electronAPI.storeSet('version', version);
    set({ version });
  },

  setLanguage: async (language: Lang) => {
    await window.electronAPI.storeSet('language', language);
    set({ language });
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

  getBgImageSettings: (filePath) => get().bgImageSettings[filePath] ?? DEFAULT_BG_IMAGE_SETTINGS,

  setBgImageSettings: async (filePath, settings) => {
    const next = { ...get().bgImageSettings, [filePath]: settings };
    await window.electronAPI.storeSet('bgImageSettings', next);
    set({ bgImageSettings: next });
  },
}));
