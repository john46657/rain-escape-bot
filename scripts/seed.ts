/**
 * Legt Basisdaten in der konfigurierten Datenbank an.
 *
 * Bewusst zurueckhaltend: nur Dinge, die jeder Server braucht
 * (Standard-Shop-Artikel und Beispiel-Achievements). Es werden keine
 * erfundenen Nutzer oder Server geschrieben — Demo-Daten gibt es nur im
 * DEV_MODE (`packages/database/src/memory/seed.ts`).
 *
 *   npm run db:seed
 */
import { createDataStore } from '@nexus/database';
import { createLogger } from '@nexus/logger';

const log = createLogger('seed', { pretty: true });

async function main(): Promise<void> {
  const store = await createDataStore();
  const guildId = process.argv[2];

  if (!guildId) {
    log.error('Server-ID fehlt', new Error('Aufruf: npm run db:seed -- <guildId>'));
    process.exit(1);
  }

  await store.economy.upsertItem({
    guildId,
    key: 'lootbox',
    name: 'Lootbox',
    description: 'Enthaelt eine zufaellige Belohnung.',
    emoji: '🎁',
    price: 1_500,
    sellPrice: 500,
    kind: 'consumable',
    roleId: null,
    payload: { minCoins: 100, maxCoins: 3_000 },
    stock: -1,
    maxPerUser: -1,
    tradable: true,
    enabled: true,
  });

  await store.achievements.upsert({
    guildId,
    key: 'first-steps',
    name: 'Erste Schritte',
    description: 'Verknuepfe dein Roblox-Konto mit Discord.',
    rarity: 'common',
    icon: '🔗',
    hidden: false,
    origin: 'cross',
    rewards: { coins: 500, xp: 250 },
    condition: { event: 'roblox.verified' },
    enabled: true,
  });

  log.info('Basisdaten angelegt', { guildId });
  await store.disconnect();
}

main().catch((error: unknown) => {
  log.error('Seed fehlgeschlagen', error);
  process.exit(1);
});
