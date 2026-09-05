/**
 * Leichtgewichtige Lokalisierung (Regel 3).
 * Keys sind typsicher: `t('moderation.banSuccess', ...)` wird geprueft.
 */
import type { Locale } from '@nexus/shared';
import { de, type TranslationTree } from './de.js';
import { en } from './en.js';

const CATALOGS: Record<Locale, TranslationTree> = { de, en };

type Primitive = string | number | boolean;

/** Erzeugt alle gueltigen Pfade des Uebersetzungsbaums als String-Union. */
type PathsOf<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${PathsOf<T[K]>}`;
}[keyof T & string];

export type TranslationKey = PathsOf<TranslationTree>;

function resolve(catalog: TranslationTree, key: string): string | undefined {
  let current: unknown = catalog;
  for (const part of key.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : undefined;
}

export function translate(locale: Locale, key: TranslationKey, vars: Record<string, Primitive> = {}): string {
  const template = resolve(CATALOGS[locale] ?? de, key) ?? resolve(de, key) ?? key;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  );
}

/** Uebersetzer mit fest gebundener Sprache. */
export type Translator = (key: TranslationKey, vars?: Record<string, Primitive>) => string;

export function createTranslator(locale: Locale): Translator {
  return (key, vars) => translate(locale, key, vars);
}

/** Discord-Locale (z. B. "de-DE") auf eine unterstuetzte Sprache abbilden. */
export function normalizeLocale(input: string | null | undefined): Locale {
  return input?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export { de, en };
