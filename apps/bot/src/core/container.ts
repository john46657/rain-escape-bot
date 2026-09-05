/**
 * Service-Container (leichtgewichtige Dependency Injection).
 *
 * Alle Module erhalten ausschliesslich dieses Objekt — keine globalen
 * Singletons, dadurch sind Module isoliert testbar (Regel 51).
 */
import type { Client } from 'discord.js';
import type { CacheService } from '@nexus/cache';
import type { DataStore } from '@nexus/database';
import type { Logger } from '@nexus/logger';
import type { PermissionService } from '@nexus/permissions';
import type { Env } from '@nexus/config';
import type { RobloxClient } from '@nexus/roblox-sdk';
import type { GuildContextService } from './guild-context.js';

export interface Services {
  client: Client;
  env: Env;
  store: DataStore;
  cache: CacheService;
  permissions: PermissionService;
  guildContext: GuildContextService;
  roblox: RobloxClient;
  log: Logger;
  /** Veroeffentlicht Ereignisse fuer Dashboard/API (Redis Pub/Sub). */
  publish: (topic: string, payload: unknown) => Promise<void>;
}
