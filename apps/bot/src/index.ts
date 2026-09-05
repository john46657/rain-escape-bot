/**
 * NEXUS Bot — Einstiegspunkt.
 *
 * Ablauf:
 *  1. Konfiguration validieren (Fail-Fast bei fehlenden Secrets)
 *  2. Infrastruktur verbinden (Datenbank, Cache)
 *  3. Module registrieren
 *  4. Discord-Client starten
 *  5. Scheduler starten
 *  6. Sauberes Herunterfahren einrichten
 */
import { Client, Events, GatewayIntentBits, Options, Partials } from 'discord.js';
import { closeCache, createCache } from '@nexus/cache';
import { loadEnv, ownerIds } from '@nexus/config';
import { createDataStore } from '@nexus/database';
import { createLogger } from '@nexus/logger';
import { PermissionService } from '@nexus/permissions';
import { RobloxClient } from '@nexus/roblox-sdk';
import { toNexusError } from '@nexus/shared';
import { GuildContextService } from './core/guild-context.js';
import { InteractionRouter } from './core/router.js';
import { ModuleRegistry } from './core/registry.js';
import { Scheduler } from './core/scheduler.js';
import type { Services } from './core/container.js';
import { coreEvents } from './events/index.js';
import { loadModules } from './modules.js';

const env = loadEnv();
const log = createLogger('bot', { pretty: env.LOG_PRETTY, level: env.LOG_LEVEL });

async function bootstrap(): Promise<void> {
  if (!env.DISCORD_TOKEN) {
    throw new Error('DISCORD_TOKEN fehlt — bitte .env konfigurieren (siehe .env.example).');
  }

  const [store, cache] = await Promise.all([createDataStore(), createCache()]);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember, Partials.User],
    // Speicher begrenzen: bei vielen Servern ist der Cache der groesste Posten.
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 100,
      PresenceManager: 0,
      GuildBanManager: 0,
      ReactionUserManager: 0,
    }),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      messages: { interval: 300, lifetime: 900 },
    },
    allowedMentions: { parse: ['users'], repliedUser: false },
  });

  const permissions = new PermissionService();
  const guildContext = new GuildContextService(store, cache, permissions, ownerIds());
  const roblox = new RobloxClient({
    apiKey: env.ROBLOX_API_KEY,
    cache: {
      getJson: (key) => cache.getJson(key),
      setJson: (key, value, ttl) => cache.setJson(key, value, ttl),
    },
  });

  const services: Services = {
    client,
    env,
    store,
    cache,
    permissions,
    guildContext,
    roblox,
    log,
    publish: async (topic, payload) => {
      await cache.publish(topic, { topic, payload, publishedAt: Date.now(), origin: 'bot' });
    },
  };

  // ---- Module laden ----
  const registry = new ModuleRegistry(log);
  const modules = loadModules();
  registry.registerAll(modules);
  log.info('Module geladen', {
    modules: modules.length,
    commands: registry.commands.size,
    components: registry.components.size,
  });

  // ---- Events verdrahten ----
  const router = new InteractionRouter(services, registry);
  client.on(Events.InteractionCreate, (interaction) => void router.handle(interaction));

  for (const handler of [...coreEvents, ...registry.events]) {
    const listener = (...args: unknown[]): void => {
      void Promise.resolve(
        (handler.execute as (services: Services, ...rest: unknown[]) => Promise<void>)(services, ...args),
      ).catch((error: unknown) => {
        log.error('Event-Handler fehlgeschlagen', toNexusError(error), { event: String(handler.event) });
      });
    };
    if (handler.once) client.once(handler.event, listener);
    else client.on(handler.event, listener);
  }

  // ---- Setup-Hooks der Module ----
  for (const module of registry.modules) {
    await module
      .setup?.(services)
      .catch((error: unknown) => log.error('Modul-Setup fehlgeschlagen', error, { module: module.name }));
  }

  await client.login(env.DISCORD_TOKEN);

  const scheduler = new Scheduler(services);
  scheduler.start(registry.jobs);

  // ---- Sauberes Herunterfahren ----
  const shutdown = async (signal: string): Promise<void> => {
    log.info('Herunterfahren eingeleitet', { signal });
    scheduler.stop();
    client.removeAllListeners();
    await client.destroy();
    await store.disconnect().catch(() => undefined);
    await closeCache().catch(() => undefined);
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

// Globale Fehlerbehandlung (Regel 40): der Prozess darf nicht stillschweigend sterben.
process.on('unhandledRejection', (reason) => {
  log.error('Unbehandelte Promise-Ablehnung', toNexusError(reason));
});
process.on('uncaughtException', (error) => {
  log.error('Unbehandelte Ausnahme', error);
  // Ein unbekannter Zustand ist gefaehrlich — kontrolliert beenden, Orchestrator startet neu.
  setTimeout(() => process.exit(1), 1_000).unref();
});

bootstrap().catch((error: unknown) => {
  log.error('Bot-Start fehlgeschlagen', toNexusError(error));
  process.exit(1);
});
