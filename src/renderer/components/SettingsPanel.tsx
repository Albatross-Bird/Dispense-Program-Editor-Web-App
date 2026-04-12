/**
 * Settings modal — opened via the "Settings" button in the toolbar.
 * Currently exposes the language selector. Future settings can be added here.
 */
import React, { useEffect } from 'react';
import { useSettingsStore } from '../store/settings-store';
import { useT } from '../hooks/useT';
import type { Lang } from '@lib/i18n';

interface SettingsPanelProps {
  onClose: () => void;
}

const LANGUAGES: { value: Lang; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文 (Chinese)' },
];

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const t           = useT();
  const language    = useSettingsStore((s) => s.language) as Lang;
  const setLanguage = useSettingsStore((s) => s.setLanguage);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); e.stopPropagation(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl p-5 w-72">
        <h3 className="text-sm font-semibold text-gray-100 mb-4">{t('settings.title')}</h3>

        {/* Language */}
        <div className="mb-5">
          <label className="block text-xs text-gray-400 mb-1">{t('settings.language')}</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as Lang)}
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 rounded"
          >
            {t('settings.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
