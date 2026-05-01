/**
 * Settings modal — opened via the "Settings" button in the toolbar.
 */
import React, { useEffect, useState } from 'react';
import { useSettingsStore } from '../store/settings-store';
import { useT } from '../hooks/useT';
import { profileLabel } from '@lib/syntax-profiles';
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
  const profiles    = useSettingsStore((s) => s.profiles);
  const loadProfiles = useSettingsStore((s) => s.loadProfiles);

  const [userDir, setUserDir]       = useState('');
  const [reloading, setReloading]   = useState(false);

  useEffect(() => {
    window.electronAPI.getUserProfilesDir().then(setUserDir);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); e.stopPropagation(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose]);

  const handleReload = async () => {
    setReloading(true);
    try {
      await window.electronAPI.reloadProfiles();
      await loadProfiles();
    } finally {
      setReloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl p-5 w-[480px] max-h-[80vh] flex flex-col">
        <h3 className="text-sm font-semibold text-gray-100 mb-4 shrink-0">{t('settings.title')}</h3>

        <div className="overflow-y-auto flex-1 min-h-0">
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

          {/* Syntax Profiles */}
          <div className="mb-5">
            <p className="text-xs font-semibold text-gray-300 mb-2">Syntax Profiles</p>

            {/* Profile list */}
            <div className="rounded border border-gray-700 divide-y divide-gray-700/60 mb-3">
              {profiles.map((p) => {
                const name = p.definitionDisplayName ?? profileLabel(p);
                const id   = p.definitionId ?? p.version;
                return (
                  <div key={id} className="flex items-start gap-2 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-semibold text-gray-200">{name}</span>
                        {p._newerSchema && (
                          <span className="text-[10px] text-yellow-400" title="Created for a newer version of Pattern Editor">⚠</span>
                        )}
                      </div>
                      <span className="text-[11px] font-mono text-gray-500">{p.version}</span>
                      {p.notes && (
                        <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{p.notes}</p>
                      )}
                    </div>
                    <span className={[
                      'shrink-0 mt-0.5 px-1.5 py-0.5 text-[10px] rounded border',
                      p._userInstalled
                        ? 'bg-blue-900/40 text-blue-300 border-blue-700/50'
                        : 'bg-gray-700/60 text-gray-400 border-gray-600/60',
                    ].join(' ')}>
                      {p._userInstalled ? 'User-installed' : 'Built-in'}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* User profiles folder */}
            <div className="mb-2">
              <label className="block text-xs text-gray-400 mb-1">User profiles folder</label>
              <div className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-[11px] font-mono text-gray-400 truncate select-all">
                {userDir || '…'}
              </div>
            </div>

            {/* Buttons */}
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => userDir && window.electronAPI.openPath(userDir)}
                disabled={!userDir}
                className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-default text-gray-300 rounded"
              >
                Open profiles folder
              </button>
              <button
                onClick={handleReload}
                disabled={reloading}
                className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-default text-gray-300 rounded"
              >
                {reloading ? 'Reloading…' : 'Reload profiles'}
              </button>
            </div>

            <p className="text-[11px] text-gray-500 leading-snug">
              To add a new software version, place a .prgdef.json file in the profiles folder and click Reload.
            </p>
          </div>
        </div>

        <div className="flex justify-end shrink-0 pt-2">
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
