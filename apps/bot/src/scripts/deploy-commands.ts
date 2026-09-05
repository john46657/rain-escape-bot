/**
 * Registriert die Slash-Commands bei Discord.
 *
 * - Mit DISCORD_DEV_GUILD_ID: Guild-Registrierung (sofort sichtbar, ideal fuer Tests)
 * - Ohne: globale Registrierung (Verteilung kann bis zu einer Stunde dauern)
 */
import { REST, Routes } from 'discord.js';
import { loadEnv } from '@nexus/config';
import { createLogger } from '@nexus/logger';
import { ModuleRegistry } from '../core/registry.js';
import { loadModules } from '../modules.js';

const env = loadEnv();
const log = createLogger('deploy-commands', { pretty: true });

async function main(): Promise<void> {
  if (!env.DISCORD_TOKEN || !env.DISCORD_CLIENT_ID) {
    throw new Error('DISCORD_TOKEN und DISCORD_CLIENT_ID werden benoetigt.');
  }

  const registry = new ModuleRegistry(log);
  registry.registerAll(loadModules());
  const body = registry.toApplicationCommands();

  const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
  const route = env.DISCORD_DEV_GUILD_ID
    ? Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_DEV_GUILD_ID)
    : Routes.applicationCommands(env.DISCORD_CLIENT_ID);

  const result = (await rest.put(route, { body })) as unknown[];
  log.info('Befehle registriert', {
    count: result.length,
    scope: env.DISCORD_DEV_GUILD_ID ? `guild:${env.DISCORD_DEV_GUILD_ID}` : 'global',
  });
}

main().catch((error: unknown) => {
  log.error('Registrierung fehlgeschlagen', error);
  process.exit(1);
});
