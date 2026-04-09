import { create } from 'zustand';
import type { SoftwareType } from '@lib/syntax-profiles';

interface SettingsStore {
  softwareType: SoftwareType;
  version: string;
  recentFiles: string[];
  loaded: boolean;

  init: () => Promise<void>;
  setSoftwareType: (type: SoftwareType) => Promise<void>;
  setVersion: (version: string) => Promise<void>;
  addRecentFile: (filePath: string) => Promise<void>;
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

  init: async () => {
    const softwareType = await storeGet<SoftwareType>('softwareType', 'MYD');
    const version = await storeGet<string>('version', '1.0');
    const recentFiles = await storeGet<string[]>('recentFiles', []);
    set({ softwareType, version, recentFiles, loaded: true });
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
}));
