import { env } from '@nexus/config';
import { logger } from '@nexus/logger';
import { MemoryDataStore } from './memory/store.js';
import type { DataStore } from './ports.js';

let instance: DataStore | undefined;

/**
 * Erstellt den DataStore.
 *
 * - Produktion: Prisma-Adapter auf PostgreSQL.
 * - DEV_MODE:   In-Memory-Adapter (kein Docker/Postgres noetig, Demo-Betrieb).
 *
 * Der Prisma-Adapter wird dynamisch importiert, damit der generierte Client
 * nur dort geladen wird, wo er wirklich gebraucht wird (`npm run db:generate`).
 */
export async function createDataStore(): Promise<DataStore> {
  if (instance) return instance;

  if (env.DEV_MODE) {
    logger.warn('DEV_MODE aktiv — In-Memory-Datenspeicher (nicht persistent)');
    const memory = new MemoryDataStore();
    if (env.DEV_SEED) {
      const { seedDemoData } = await import('./memory/seed.js');
      await seedDemoData(memory);
      logger.info('Demo-Daten geladen (DEV_SEED=true)');
    }
    instance = memory;
    return instance;
  }

  const { PrismaDataStore } = await import('./prisma/store.js');
  instance = await PrismaDataStore.connect();
  logger.info('PostgreSQL via Prisma verbunden');
  return instance;
}

export function getDataStore(): DataStore {
  if (!instance) throw new Error('DataStore nicht initialisiert — createDataStore() zuerst aufrufen');
  return instance;
}

/** Nur fuer Tests / Seeding. */
export function setDataStore(store: DataStore): void {
  instance = store;
}
