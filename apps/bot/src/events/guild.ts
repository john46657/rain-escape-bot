import { Events } from 'discord.js';
import type { EventHandler } from '../core/types.js';

export const guildCreate: EventHandler<Events.GuildCreate> = {
  event: Events.GuildCreate,
  execute: async (services, guild) => {
    await services.store.guilds.upsert({
      discordId: guild.id,
      name: guild.name,
      icon: guild.iconURL(),
      ownerId: guild.ownerId,
      memberCount: guild.memberCount,
    });
    await services.guildContext.invalidate(guild.id);
    services.log.info('Server hinzugefuegt', {
      guildId: guild.id,
      name: guild.name,
      members: guild.memberCount,
    });
    await services.publish('guild.joined', { guildId: guild.id, name: guild.name });
  },
};

export const guildDelete: EventHandler<Events.GuildDelete> = {
  event: Events.GuildDelete,
  execute: async (services, guild) => {
    await services.store.guilds.markInactive(guild.id);
    await services.guildContext.invalidate(guild.id);
    services.log.info('Server entfernt', { guildId: guild.id });
    await services.publish('guild.left', { guildId: guild.id });
  },
};
