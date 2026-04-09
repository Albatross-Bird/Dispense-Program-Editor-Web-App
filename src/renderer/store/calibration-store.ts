import { create } from 'zustand';
import type { AffineTransform, CalibPoint } from '@lib/affine';

export interface CalibrationData {
  points: CalibPoint[];
  transform: AffineTransform | null;
}

interface CalibrationStore {
  calibrations: Record<string, CalibrationData>;
  loaded: boolean;

  init: () => Promise<void>;
  /** key = `${filePath}::${patternName}` */
  getCalibration: (key: string) => CalibrationData | null;
  setCalibration: (key: string, data: CalibrationData) => Promise<void>;
  clearCalibration: (key: string) => Promise<void>;
}

export const useCalibrationStore = create<CalibrationStore>((set, get) => ({
  calibrations: {},
  loaded: false,

  init: async () => {
    const stored = await window.electronAPI.storeGet('calibrations');
    const calibrations = (stored as Record<string, CalibrationData>) ?? {};
    set({ calibrations, loaded: true });
  },

  getCalibration: (key) => get().calibrations[key] ?? null,

  setCalibration: async (key, data) => {
    const calibrations = { ...get().calibrations, [key]: data };
    await window.electronAPI.storeSet('calibrations', calibrations);
    set({ calibrations });
  },

  clearCalibration: async (key) => {
    const { [key]: _removed, ...rest } = get().calibrations;
    await window.electronAPI.storeSet('calibrations', rest);
    set({ calibrations: rest });
  },
}));
