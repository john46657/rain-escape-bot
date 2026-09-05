import { ChannelType, PermissionFlagsBits, SlashCommandBuilder, type Guild } from 'discord.js';
import {
  embeds, requireConfirmation, writeAudit, type NexusModule, type SlashCommand,
} from '@nexus/bot-core';
import { PreconditionError, discordTimestamp } from '@nexus/shared';

/**
 * Modul: Backups (Regel 8/28).
 *
 * Gesichert wird die Serverstruktur (Rollen, Kanaele, Rechte) — keine
 * Nachrichteninhalte. Beim Wiederherstellen werden fehlende Elemente neu
 * angelegt; bestehende bleiben unangetastet (kein destruktives Restore).
 */

interface BackupPayload {
  roles: Array<{ name: string; color: number; hoist: boolean; mentionable: boolean; permissions: string; position: number }>;
  channels: Array<{ name: string; type: number; parentName: string | null; position: number; topic: string | null; nsfw: boolean }>;
  settings: { name: string; verificationLevel: number; afkTimeout: number };
}

function snapshot(guild: Guild): BackupPayload {
  return {
    roles: [...guild.roles.cache.values()]
      .filter((role) => !role.managed && role.id !== guild.id)
      .sort((a, b) => b.position - a.position)
      .map((role) => ({
        name: role.name,
        color: role.color,
        hoist: role.hoist,
        mentionable: role.mentionable,
        permissions: role.permissions.bitfield.toString(),
        position: role.position,
      })),
    channels: [...guild.channels.cache.values()]
      .sort((a, b) => ('position' in a && 'position' in b ? a.position - b.position : 0))
      .map((channel) => ({
        name: channel.name,
        type: channel.type,
        parentName: channel.parent?.name ?? null,
        position: 'position' in channel ? channel.position : 0,
        topic: 'topic' in channel ? channel.topic : null,
        nsfw: 'nsfw' in channel ? Boolean(channel.nsfw) : false,
      })),
    settings: {
      name: guild.name,
      verificationLevel: guild.verificationLevel,
      afkTimeout: guild.afkTimeout,
    },
  };
}

const backup: SlashCommand = {
  category: 'backup',
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Server-Backups verwalten')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Erstellt ein Backup der Serverstruktur')
        .addStringOption((option) => option.setName('name').setDescription('Bezeichnung').setMaxLength(100)),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Zeigt vorhandene Backups'))
    .addSubcommand((sub) =>
      sub
        .setName('restore')
        .setDescription('Stellt fehlende Rollen und Kanaele wieder her')
        .addStringOption((option) => option.setName('id').setDescription('Backup-ID').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Loescht ein Backup')
        .addStringOption((option) => option.setName('id').setDescription('Backup-ID').setRequired(true)),
    ),
  execute: async (ctx) => {
    const { interaction, services, t } = ctx;
    const guild = interaction.guild!;
    const sub = interaction.options.getSubcommand();

    switch (sub) {
      case 'create': {
        await ctx.requirePermission('discord.backup.create');
        await interaction.deferReply({ ephemeral: true });
        const payload = snapshot(guild);
        const entity = await services.store.backups.create({
          guildId: guild.id,
          name: interaction.options.getString('name') ?? `Backup ${new Date().toLocaleString('de-DE')}`,
          createdById: interaction.user.id,
          payload,
          summary: { roles: payload.roles.length, channels: payload.channels.length },
        });
        await writeAudit(services, {
          guildId: guild.id, actorId: interaction.user.id, actorType: 'discord',
          action: 'backup.create', targetId: entity.id, targetType: 'backup',
          result: 'SUCCESS', reason: null, metadata: entity.summary,
        });
        await interaction.editReply({
          embeds: [
            embeds.success(
              `Backup \`${entity.id.slice(0, 8)}\` erstellt.\n` +
                `${payload.roles.length} Rollen · ${payload.channels.length} Kanaele · ${(entity.sizeBytes / 1024).toFixed(1)} KB`,
            ),
          ],
        });
        return;
      }
      case 'list': {
        await ctx.requirePermission('discord.backup.view');
        const list = await services.store.backups.list(guild.id);
        await interaction.reply({
          embeds: [
            embeds.primary(
              '💾 Backups',
              list
                .map(
                  (entry) =>
                    `\`${entry.id.slice(0, 8)}\` **${entry.name}**\n` +
                    `${discordTimestamp(entry.createdAt, 'R')} · ${entry.summary['roles'] ?? 0} Rollen · ` +
                    `${entry.summary['channels'] ?? 0} Kanaele` +
                    (entry.restoredAt ? ` · wiederhergestellt ${discordTimestamp(entry.restoredAt, 'R')}` : ''),
                )
                .join('\n\n') || 'Noch keine Backups.',
            ),
          ],
          ephemeral: true,
        });
        return;
      }
      case 'delete': {
        await ctx.requirePermission('discord.backup.create');
        const id = interaction.options.getString('id', true);
        const list = await services.store.backups.list(guild.id);
        const entity = list.find((entry) => entry.id.startsWith(id));
        if (!entity) throw new PreconditionError('Backup nicht gefunden');
        await services.store.backups.delete(guild.id, entity.id);
        await interaction.reply({ embeds: [embeds.success('Backup geloescht.')], ephemeral: true });
        return;
      }
      default: {
        // Wiederherstellung ist die riskanteste Operation — eigenes Recht + Bestaetigung.
        await ctx.requirePermission('discord.backup.restore');
        const id = interaction.options.getString('id', true);
        const list = await services.store.backups.list(guild.id);
        const meta = list.find((entry) => entry.id.startsWith(id));
        if (!meta) throw new PreconditionError('Backup nicht gefunden');
        const entity = await services.store.backups.get(guild.id, meta.id);
        if (!entity) throw new PreconditionError('Backup nicht lesbar');

        const confirmed = await requireConfirmation(interaction, {
          title: '⚠️ Backup wiederherstellen',
          description:
            `Fehlende Rollen und Kanaele aus **${meta.name}** werden neu angelegt.\n` +
            'Bestehende Elemente werden NICHT geloescht oder ueberschrieben.',
          confirmLabel: 'Wiederherstellen',
          cancelLabel: t('common.cancel'),
        });
        if (!confirmed) return;

        const payload = entity.payload as BackupPayload;
        let createdRoles = 0;
        let createdChannels = 0;

        for (const role of payload.roles) {
          if (guild.roles.cache.some((existing) => existing.name === role.name)) continue;
          await guild.roles
            .create({
              name: role.name, color: role.color, hoist: role.hoist,
              mentionable: role.mentionable, permissions: BigInt(role.permissions),
              reason: `NEXUS Restore ${meta.id.slice(0, 8)}`,
            })
            .then(() => createdRoles++)
            .catch(() => undefined);
        }

        for (const channel of payload.channels.filter((entry) => entry.type === ChannelType.GuildCategory)) {
          if (guild.channels.cache.some((existing) => existing.name === channel.name)) continue;
          await guild.channels
            .create({ name: channel.name, type: ChannelType.GuildCategory, reason: 'NEXUS Restore' })
            .then(() => createdChannels++)
            .catch(() => undefined);
        }
        for (const channel of payload.channels.filter((entry) => entry.type !== ChannelType.GuildCategory)) {
          if (guild.channels.cache.some((existing) => existing.name === channel.name)) continue;
          const parent = channel.parentName
            ? guild.channels.cache.find(
                (existing) => existing.type === ChannelType.GuildCategory && existing.name === channel.parentName,
              )
            : undefined;
          await guild.channels
            .create({
              name: channel.name,
              type: channel.type === ChannelType.GuildVoice ? ChannelType.GuildVoice : ChannelType.GuildText,
              parent: parent?.id,
              reason: 'NEXUS Restore',
            })
            .then(() => createdChannels++)
            .catch(() => undefined);
        }

        await services.store.backups.markRestored(meta.id, interaction.user.id);
        await writeAudit(services, {
          guildId: guild.id, actorId: interaction.user.id, actorType: 'discord',
          action: 'backup.restore', targetId: meta.id, targetType: 'backup',
          result: 'SUCCESS', reason: null, metadata: { createdRoles, createdChannels },
        });
        await interaction.editReply({
          embeds: [embeds.success(`Wiederherstellung abgeschlossen: ${createdRoles} Rollen, ${createdChannels} Kanaele angelegt.`)],
          components: [],
        });
      }
    }
  },
};

const backupModule: NexusModule = {
  name: 'backup',
  description: 'Backups der Serverstruktur',
  commands: [backup],
};

export default backupModule;
