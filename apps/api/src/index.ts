/** NEXUS API — Einstiegspunkt. */
import { loadEnv } from '@nexus/config';
import { createLogger } from '@nexus/logger';
import { toNexusError } from '@nexus/shared';
import { buildServer } from './server.js';

const env = loadEnv();
const log = createLogger('api', { pretty: env.LOG_PRETTY, level: env.LOG_LEVEL });

async function main(): Promise<void> {
  const app = await buildServer();
  // 0.0.0.0: der Dienst laeuft in Containern und hinter Reverse Proxies.
  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  log.info('API bereit', { port: env.API_PORT, devMode: env.DEV_MODE });

  const shutdown = async (signal: string): Promise<void> => {
    log.info('API wird beendet', { signal });
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

process.on('unhandledRejection', (reason) => log.error('Unbehandelte Ablehnung', toNexusError(reason)));

main().catch((error: unknown) => {
  log.error('API-Start fehlgeschlagen', toNexusError(error));
  process.exit(1);
});
