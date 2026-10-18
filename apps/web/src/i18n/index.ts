import { en, type I18nKey } from './en';

const dictionaries: Record<string, Record<string, string>> = { en };
let lang = 'en';

export function setLanguage(l: string) {
  if (dictionaries[l]) lang = l;
}

/** Translate a key with {placeholders}. Falls back to English, then to the key. */
export function t(key: I18nKey | string, vars: Record<string, string | number> = {}): string {
  const raw = dictionaries[lang]?.[key] ?? (en as Record<string, string>)[key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}
