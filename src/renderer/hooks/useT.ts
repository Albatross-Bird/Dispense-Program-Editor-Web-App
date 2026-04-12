import { useSettingsStore } from '../store/settings-store';
import { translate, type Lang } from '@lib/i18n';

/** Returns a bound translation function for the current language setting. */
export function useT() {
  const language = useSettingsStore((s) => s.language) as Lang;
  return (key: string, vars?: Record<string, string>) => translate(key, language, vars);
}
