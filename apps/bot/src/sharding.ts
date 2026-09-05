/**
 * Sharding-Manager (Regel 1/42).
 *
 * Ab ~2.000 Servern schreibt Discord Sharding vor. Der Manager startet
 * mehrere Bot-Prozesse und startet abgestuerzte Shards neu.
 */
import { ShardingManager } from 'discord.js';
import { loadEnv } from '@nexus/config';
import { createLogger } from '@nexus/logger';

const env = loadEnv();
const log = createLogger('sharding', { pretty: env.LOG_PRETTY });

if (!env.DISCORD_TOKEN) {
  log.error('DISCORD_TOKEN fehlt', new Error('DISCORD_TOKEN nicht gesetzt'));
  process.exit(1);
}

const manager = new ShardingManager(new URL('./index.ts', import.meta.url).pathname, {
  token: env.DISCORD_TOKEN,
  totalShards: env.DISCORD_SHARD_COUNT ?? 'auto',
  respawn: true,
  execArgv: ['--import', 'tsx'],
});

manager.on('shardCreate', (shard) => {
  log.info('Shard gestartet', { shardId: shard.id });
  shard.on('death', () => log.error('Shard beendet', new Error('Shard-Prozess beendet'), { shardId: shard.id }));
  shard.on('ready', () => log.info('Shard bereit', { shardId: shard.id }));
});

void manager.spawn({ delay: 5_500, timeout: 120_000 }).catch((error: unknown) => {
  log.error('Shard-Start fehlgeschlagen', error);
  process.exit(1);
});
