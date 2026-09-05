import { Events } from 'discord.js';
import type { AnyEventHandler, EventHandler } from '../core/types.js';

/**
 * Gateway-Fehler duerfen den Prozess nie beenden (Regel 40).
 * discord.js reconnectet selbstaendig; wir protokollieren nur.
 */
export const errorEvents: AnyEventHandler[] = [
  {
    event: Events.Error,
    execute: async (services, error) => {
      services.log.error('Discord-Client-Fehler', error);
    },
  } as EventHandler<Events.Error>,
  {
    event: Events.Warn,
    execute: async (services, message) => {
      services.log.warn('Discord-Warnung', { message });
    },
  } as EventHandler<Events.Warn>,
  {
    event: Events.ShardDisconnect,
    execute: async (services, event, shardId) => {
      services.log.warn('Shard getrennt', { shardId, code: event.code });
    },
  } as EventHandler<Events.ShardDisconnect>,
  {
    event: Events.ShardReconnecting,
    execute: async (services, shardId) => {
      services.log.info('Shard verbindet neu', { shardId });
    },
  } as EventHandler<Events.ShardReconnecting>,
  {
    event: Events.ShardError,
    execute: async (services, error, shardId) => {
      services.log.error('Shard-Fehler', error, { shardId });
    },
  } as EventHandler<Events.ShardError>,
];
