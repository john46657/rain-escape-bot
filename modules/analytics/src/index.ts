import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { embeds, progressBar, type NexusModule, type SlashCommand } from '@nexus/bot-core';
import { startOfDay } from '@nexus/shared';

/**
 * Modul: Analytics (Regel 31).
 * Stuendliche Momentaufnahmen; das Dashboard rendert daraus Zeitreihen.
 */
const analytics: SlashCommand = {
  category: 'analytics',
  permission: 'dashboard.analytics.view',
  data: new SlashCommandBuilder()
    .setName('analytics')
    .setDescription('Zeigt Server-Kennzahlen')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  execute: async ({ interaction, services }) => {
    const guildId = interaction.guildId!;
    await interaction.deferReply();
    const summary = await services.store.analytics.summary(guildId);
    const guild = interaction.guild!;

    await interaction.editReply({
      embeds: [
        embeds
          .primary('📊 Analytics', `Momentaufnahme fuer **${guild.name}**`)
          .addFields(
            { name: 'Mitglieder', value: Number(summary.members ?? 0).toLocaleString('de-DE'), inline: true },
            { name: 'Moderationsfaelle', value: String(summary.cases), inline: true },
            { name: 'Offene Tickets', value: String(summary.openTickets), inline: true },
            { name: 'Offene Vorfaelle', value: String(summary.openIncidents), inline: true },
            { name: 'Verifizierte Mitglieder', value: String(summary.verifiedMembers), inline: true },
            { name: 'Roblox-Server online', value: String(summary.robloxServers), inline: true },
            {
              name: 'Verifizierungsquote',
              value: progressBar(Number(summary.verifiedMembers ?? 0), Math.max(1, Number(summary.members ?? 0))),
            },
          ),
      ],
    });
  },
};

const analyticsModule: NexusModule = {
  name: 'analytics',
  description: 'Kennzahlen und Zeitreihen',
  commands: [analytics],
  jobs: [
    {
      name: 'analytics:snapshot',
      intervalMs: 60 * 60_000,
      singleton: true,
      runOnStart: true,
      execute: async (services) => {
        const bucket = startOfDay(new Date());
        for (const guild of services.client.guilds.cache.values()) {
          const summary = await services.store.analytics.summary(guild.id);
          await services.store.analytics.record({
            guildId: guild.id,
            granularity: 'day',
            bucket,
            scope: 'discord',
            metrics: {
              members: Number(summary.members ?? 0),
              cases: Number(summary.cases ?? 0),
              openTickets: Number(summary.openTickets ?? 0),
              openIncidents: Number(summary.openIncidents ?? 0),
              verified: Number(summary.verifiedMembers ?? 0),
              robloxServers: Number(summary.robloxServers ?? 0),
            },
          });
        }
      },
    },
  ],
};

export default analyticsModule;
