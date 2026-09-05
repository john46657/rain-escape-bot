import { ActivityType, Events } from 'discord.js';
import type { EventHandler } from '../core/types.js';

export const ready: EventHandler<Events.ClientReady> = {
  event: Events.ClientReady,
  once: true,
  execute: async (services) => {
    const client = services.client;
    services.log.info('Bot bereit', {
      user: client.user?.tag,
      guilds: client.guilds.cache.size,
      shard: client.shard?.ids[0] ?? 0,
    });

    client.user?.setPresence({
      status: 'online',
      activities: [{ name: 'Discord × Roblox', type: ActivityType.Watching }],
    });

    // Guilds mit der Datenbank abgleichen (Neustarts, Offline-Joins).
    for (const guild of client.guilds.cache.values()) {
      await services.store.guilds
        .upsert({
          discordId: guild.id,
          name: guild.name,
          icon: guild.iconURL(),
          ownerId: guild.ownerId,
          memberCount: guild.memberCount,
        })
        .catch((error: unknown) =>
          services.log.error('Guild-Sync fehlgeschlagen', error, { guildId: guild.id }),
        );
    }

    await services.publish('bot.ready', {
      guilds: client.guilds.cache.size,
      shard: client.shard?.ids[0] ?? 0,
    });
  },
};
