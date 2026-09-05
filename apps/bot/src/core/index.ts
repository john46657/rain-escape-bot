/**
 * Oeffentliche API des Bot-Kerns.
 * Module importieren ausschliesslich ueber `@nexus/bot-core`.
 */
export * from './types.js';
export * from './container.js';
export * from './embeds.js';
export * from './registry.js';
export * from './router.js';
export * from './scheduler.js';
export * from './guild-context.js';
export * from './audit.js';
export * from './discord-utils.js';
export { createTranslator, normalizeLocale, translate } from '../i18n/index.js';
export type { Translator, TranslationKey } from '../i18n/index.js';
