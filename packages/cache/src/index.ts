import { env } from '@nexus/config';
import { logger } from '@nexus/logger';
import type { CacheDriver } from './driver.js';
import { MemoryCacheDriver } from './memory-driver.js';
import { CacheService } from './service.js';

export * from './driver.js';
export * from './memory-driver.js';
export * from './redis-driver.js';
export * from './service.js';

let instance: CacheService | undefined;

/**
 * Erstellt den Cache-Service.
 * Im DEV_MODE (oder wenn ioredis nicht verfuegbar ist) wird transparent auf
 * den In-Memory-Treiber zurueckgefallen, damit lokale Entwicklung ohne Redis
 * moeglich bleibt. In der Produktion ist Redis Pflicht.
 */
export async function createCache(): Promise<CacheService> {
  if (instance) return instance;

  if (env.DEV_MODE) {
    logger.warn('DEV_MODE aktiv — In-Memory-Cache statt Redis (nicht clusterfaehig)');
    instance = new CacheService({ driver: new MemoryCacheDriver(), prefix: env.REDIS_PREFIX });
    return instance;
  }

  const { default: IORedis } = await import('ioredis');
  const redis = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
  });
  redis.on('error', (error: Error) => logger.error('Redis-Verbindungsfehler', error));
  await redis.connect();

  const { RedisCacheDriver } = await import('./redis-driver.js');
  const driver: CacheDriver = new RedisCacheDriver(redis);
  instance = new CacheService({ driver, prefix: env.REDIS_PREFIX });
  logger.info('Redis verbunden');
  return instance;
}

export function getCache(): CacheService {
  if (!instance) throw new Error('Cache nicht initialisiert — createCache() zuerst aufrufen');
  return instance;
}

export async function closeCache(): Promise<void> {
  await instance?.close();
  instance = undefined;
}
