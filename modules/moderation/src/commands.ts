/**
 * Moderationsbefehle (Regel 5).
 * Jeder Befehl prueft: NEXUS-Berechtigung -> Discord-Rechte -> Hierarchie -> Ausfuehrung.
 */
import {
  ChannelType, PermissionFlagsBits, SlashCommandBuilder, type GuildMember, type TextChannel,
} from 'discord.js';
import {
  MODERATION_PERMISSIONS, assertBotPermission, bulkDelete, embeds, requireConfirmation,
  truncate, writeAudit, type SlashCommand,
} from '@nexus/bot-core';
import { LIMITS, PreconditionError, discordTimestamp, formatDuration, parseDuration } from '@nexus/shared';
import { ModerationService } from './service.js';

const reasonOption = (builder: SlashCommandBuilder | ReturnType<SlashCommandBuilder['addUserOption']>) => builder;

function parseRequiredDuration(input: string): number {
  const duration = parseDuration(input);
  if (duration === null || duration <= 0) {
    throw new PreconditionError(`Ungueltige Dauer: "${input}". Beispiele: 10m, 2h, 7d`);
  }
  return duration;
}

export const ban: SlashCommand = {
  category: 'moderation',
  permission: 'discord.moderation.ban',
  moduleToggle: 'moderationEnabled',
  cooldownMs: 3_000,
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bannt einen Nutzer')
    .setDescriptionLocalizations({ 'en-US': 'Bans a user' })
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((option) => option.setName('user').setDescription('Zielnutzer').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Grund').setMaxLength(500))
    .addStringOption((option) =>
      option.setName('duration').setDescription('Temporaerer Bann, z. B. 7d (leer = permanent)'),
    )
    .addIntegerOption((option) =>
      option
        .setName('delete_days')
        .setDescription('Nachrichten der letzten Tage loeschen (0-7)')
        .setMinValue(0)
        .setMaxValue(7),
    ),
  execute: async ({ interaction, t, services }) => {
    const target = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') ?? t('moderation.noReason');
    const durationInput = interaction.options.getString('duration');
    const durationMs = durationInput ? parseRequiredDuration(durationInput) : null;
    const deleteDays = interaction.options.getInteger('delete_days') ?? 0;

    const confirmed = await requireConfirmation(interaction, {
      title: t('common.confirmationRequired'),
      description:
        `**${target.tag}** (\`${target.id}\`) wird gebannt.\n` +
        `**Grund:** ${reason}\n` +
        `**Dauer:** ${durationMs ? formatDuration(durationMs, 3) : 'permanent'}\n` +
        `**Nachrichten loeschen:** ${deleteDays} Tag(e)`,
      confirmLabel: t('common.confirm'),
      cancelLabel: t('common.cancel'),
    });
    if (!confirmed) return;

    const entry = await ModerationService.execute({
      services,
      guild: interaction.guild!,
      moderator: interaction.member as GuildMember,
      target,
      action: 'BAN',
      reason,
      durationMs,
      deleteMessageSeconds: deleteDays * 24 * 60 * 60,
    });

    await interaction.editReply({
      embeds: [embeds.success(t('moderation.banSuccess', { user: target.tag, case: entry.caseId }))],
      components: [],
    });
  },
};

export const unban: SlashCommand = {
  category: 'moderation',
  permission: 'discord.moderation.unban',
  moduleToggle: 'moderationEnabled',
  cooldownMs: 3_000,
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Hebt einen Bann auf')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption((option) =>
      option.setName('user_id').setDescription('Discord-ID des gebannten Nutzers').setRequired(true).setAutocomplete(true),
    )
    .addStringOption((option) => option.setName('reason').setDescription('Grund').setMaxLength(500)),
  autocomplete: async ({ interaction }) => {
    const focused = interaction.options.getFocused().toLowerCase();
    const bans = await interaction.guild?.bans.fetch().catch(() => null);
    const choices = [...(bans?.values() ?? [])]
      .filter((entry) => entry.user.tag.toLowerCase().includes(focused) || entry.user.id.includes(focused))
      .slice(0, LIMITS.autocompleteChoices)
      .map((entry) => ({ name: truncate(`${entry.user.tag} (${entry.user.id})`, 100), value: entry.user.id }));
    await interaction.respond(choices);
  },
  execute: async ({ interaction, t, services }) => {
    const userId = interaction.options.getString('user_id', true);
    const reason = interaction.options.getString('reason') ?? t('moderation.noReason');
    const user = await services.client.users.fetch(userId).catch(() => null);
    if (!user) throw new PreconditionError('Nutzer konnte nicht gefunden werden');

    await interaction.deferReply();
    const entry = await ModerationService.execute({
      services,
      guild: interaction.guild!,
      moderator: interaction.member as GuildMember,
      target: user,
      action: 'UNBAN',
      reason,
      notify: false,
    });
    await interaction.editReply({
      embeds: [embeds.success(t('moderation.unbanSuccess', { user: user.tag, case: entry.caseId }))],
    });
  },
};

export const kick: SlashCommand = {
  category: 'moderation',
  permission: 'discord.moderation.kick',
  moduleToggle: 'moderationEnabled',
  cooldownMs: 3_000,
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kickt einen Nutzer')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((option) => option.setName('user').setDescription('Zielnutzer').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Grund').setMaxLength(500)),
  execute: async ({ interaction, t, services }) => {
    const target = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') ?? t('moderation.noReason');
    await interaction.deferReply();
    const entry = await ModerationService.execute({
      services,
      guild: interaction.guild!,
      moderator: interaction.member as GuildMember,
      target,
      action: 'KICK',
      reason,
    });
    await interaction.editReply({
      embeds: [embeds.success(t('moderation.kickSuccess', { user: target.tag, case: entry.caseId }))],
    });
  },
};

export const softban: SlashCommand = {
  category: 'moderation',
  permission: 'discord.moderation.ban',
  moduleToggle: 'moderationEnabled',
  cooldownMs: 3_000,
  data: new SlashCommandBuilder()
    .setName('softban')
    .setDescription('Bannt und entbannt sofort — loescht die Nachrichten des Nutzers')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((option) => option.setName('user').setDescription('Zielnutzer').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Grund').setMaxLength(500)),
  execute: async ({ interaction, t, services }) => {
    const target = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') ?? t('moderation.noReason');
    await interaction.deferReply();
    const entry = await ModerationService.execute({
      services,
      guild: interaction.guild!,
      moderator: interaction.member as GuildMember,
      target,
      action: 'SOFTBAN',
      reason,
    });
    await interaction.editReply({
      embeds: [embeds.success(t('moderation.softbanSuccess', { user: target.tag, case: entry.caseId }))],
    });
  },
};

export const timeout: SlashCommand = {
  category: 'moderation',
  permission: 'discord.moderation.timeout',
  moduleToggle: 'moderationEnabled',
  cooldownMs: 2_000,
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Schaltet einen Nutzer voruebergehend stumm')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) => option.setName('user').setDescription('Zielnutzer').setRequired(true))
    .addStringOption((option) =>
      option.setName('duration').setDescription('Dauer, z. B. 10m, 2h, 7d (max. 28d)').setRequired(true),
    )
    .addStringOption((option) => option.setName('reason').setDescription('Grund').setMaxLength(500)),
  execute: async ({ interaction, t, services }) => {
    const target = interaction.options.getUser('user', true);
    const durationMs = parseRequiredDuration(interaction.options.getString('duration', true));
    const reason = interaction.options.getString('reason') ?? t('moderation.noReason');

    await interaction.deferReply();
    const entry = await ModerationService.execute({
      services,
      guild: interaction.guild!,
      moderator: interaction.member as GuildMember,
      target,
      action: 'TIMEOUT',
      reason,
      durationMs,
    });
    await interaction.editReply({
      embeds: [
        embeds.success(
          t('moderation.timeoutSuccess', {
            user: target.tag, duration: formatDuration(durationMs, 3), case: entry.caseId,
          }),
        ),
      ],
    });
  },
};

export const untimeout: SlashCommand = {
  category: 'moderation',
  permission: 'discord.moderation.timeout',
  moduleToggle: 'moderationEnabled',
  data: new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('Hebt einen Timeout auf')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) => option.setName('user').setDescription('Zielnutzer').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Grund').setMaxLength(500)),
  execute: async ({ interaction, t, services }) => {
    const target = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') ?? t('moderation.noReason');
    await interaction.deferReply();
    const entry = await ModerationService.execute({
      services,
      guild: interaction.guild!,
      moderator: interaction.member as GuildMember,
      target,
      action: 'UNTIMEOUT',
      reason,
    });
    await interaction.editReply({
      embeds: [embeds.success(t('moderation.untimeoutSuccess', { user: target.tag, case: entry.caseId }))],
    });
  },
};

export const warn: SlashCommand = {
  category: 'moderation',
  permission: 'discord.moderation.warn',
  moduleToggle: 'moderationEnabled',
  cooldownMs: 2_000,
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Verwarnt einen Nutzer')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) => option.setName('user').setDescription('Zielnutzer').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Grund').setRequired(true).setMaxLength(500))
    .addStringOption((option) => option.setName('expires').setDescription('Verfaellt nach, z. B. 30d')),
  execute: async ({ interaction, t, services }) => {
    const target = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason', true);
    const expiresInput = interaction.options.getString('expires');
    const durationMs = expiresInput ? parseRequiredDuration(expiresInput) : null;

    await interaction.deferReply();
    const entry = await ModerationService.execute({
      services,
      guild: interaction.guild!,
      moderator: interaction.member as GuildMember,
      target,
      action: 'WARN',
      reason,
      durationMs,
    });

    const warnings = await services.store.moderation.listWarnings(interaction.guildId!, target.id);
    await interaction.editReply({
      embeds: [
        embeds
          .success(t('moderation.warnSuccess', { user: target.tag, case: entry.caseId }))
          .addFields({ name: 'Aktive Verwarnungen', value: String(warnings.length), inline: true }),
      ],
    });
  },
};

export const warnings: SlashCommand = {
  category: 'moderation',
  permission: 'discord.moderation.view',
  moduleToggle: 'moderationEnabled',
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('Zeigt die Verwarnungen eines Nutzers')
    .addUserOption((option) => option.setName('user').setDescription('Zielnutzer').setRequired(true)),
  execute: async ({ interaction, t, services }) => {
    const target = interaction.options.getUser('user', true);
    const list = await services.store.moderation.listWarnings(interaction.guildId!, target.id);

    if (list.length === 0) {
      await interaction.reply({ embeds: [embeds.info(t('moderation.noCases'))], ephemeral: true });
      return;
    }

    const description = list
      .slice(0, 15)
      .map(
        (entry, index) =>
          `**${index + 1}.** ${entry.reason}\n` +
          `<@${entry.moderatorId}> · ${discordTimestamp(entry.createdAt, 'R')}` +
          (entry.expiresAt ? ` · laeuft ab ${discordTimestamp(entry.expiresAt, 'R')}` : ''),
      )
      .join('\n\n');

    await interaction.reply({
      embeds: [
        embeds
          .primary(t('moderation.warningsTitle', { user: target.tag }), truncate(description, 4000))
          .setFooter({ text: t('moderation.warningCount', { count: list.length }) }),
      ],
    });
  },
};

export const clear: SlashCommand = {
  category: 'moderation',
  permission: 'discord.moderation.clear',
  moduleToggle: 'moderationEnabled',
  cooldownMs: 5_000,
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Loescht Nachrichten im aktuellen Kanal')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((option) =>
      option.setName('amount').setDescription('Anzahl (1-100)').setRequired(true).setMinValue(1).setMaxValue(100),
    )
    .addUserOption((option) => option.setName('user').setDescription('Nur Nachrichten dieses Nutzers'))
    .addStringOption((option) => option.setName('reason').setDescription('Grund')),
  execute: async ({ interaction, t, services }) => {
    const amount = interaction.options.getInteger('amount', true);
    const filterUser = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') ?? t('moderation.noReason');
    const channel = interaction.channel;
    if (!channel || !('bulkDelete' in channel)) {
      throw new PreconditionError('In diesem Kanaltyp koennen keine Nachrichten geloescht werden');
    }

    assertBotPermission(
      interaction.guild!, MODERATION_PERMISSIONS.manageMessages.flag, MODERATION_PERMISSIONS.manageMessages.label,
    );
    await interaction.deferReply({ ephemeral: true });

    const fetched = await channel.messages.fetch({ limit: Math.min(100, amount + (filterUser ? 50 : 0)) });
    const candidates = [...fetched.values()]
      .filter((message) => !filterUser || message.author.id === filterUser.id)
      .slice(0, amount);

    const { deleted, skippedTooOld } = await bulkDelete(channel as TextChannel, candidates);

    await ModerationService.execute({
      services,
      guild: interaction.guild!,
      moderator: interaction.member as GuildMember,
      target: filterUser ?? interaction.user,
      action: 'CLEAR',
      reason,
      notify: false,
      metadata: { deleted, channelId: channel.id, filterUserId: filterUser?.id ?? null },
    });

    await interaction.editReply({
      embeds: [
        embeds.success(
          t('moderation.clearSuccess', { count: deleted }) +
            (skippedTooOld > 0 ? `\n⚠️ ${skippedTooOld} Nachricht(en) waren aelter als 14 Tage (Discord-Limit).` : ''),
        ),
      ],
    });
  },
};

export const slowmode: SlashCommand = {
  category: 'moderation',
  permission: 'discord.moderation.channel',
  moduleToggle: 'moderationEnabled',
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Setzt den Slowmode des aktuellen Kanals')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption((option) =>
      option.setName('duration').setDescription('z. B. 10s, 5m, 0 zum Deaktivieren').setRequired(true),
    ),
  execute: async ({ interaction, t, services }) => {
    const input = interaction.options.getString('duration', true);
    const durationMs = input === '0' ? 0 : parseRequiredDuration(input);
    const seconds = Math.min(21_600, Math.floor(durationMs / 1000)); // Discord-Limit: 6 Stunden
    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) {
      throw new PreconditionError('Slowmode ist nur in Textkanaelen moeglich');
    }
    assertBotPermission(
      interaction.guild!, MODERATION_PERMISSIONS.manageChannels.flag, MODERATION_PERMISSIONS.manageChannels.label,
    );
    await channel.setRateLimitPerUser(seconds, `Slowmode via NEXUS — ${interaction.user.tag}`);
    await writeAudit(services, {
      guildId: interaction.guildId!,
      actorId: interaction.user.id,
      actorType: 'discord',
      action: 'moderation.slowmode',
      targetId: channel.id,
      targetType: 'channel',
      result: 'SUCCESS',
      reason: null,
      metadata: { seconds },
    });
    await interaction.reply({
      embeds: [embeds.success(t('moderation.slowmodeSuccess', { duration: seconds === 0 ? 'aus' : `${seconds}s` }))],
    });
  },
};

export const lock: SlashCommand = {
  category: 'moderation',
  permission: 'discord.moderation.channel',
  moduleToggle: 'moderationEnabled',
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Sperrt den aktuellen Kanal fuer @everyone')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption((option) => option.setName('reason').setDescription('Grund')),
  execute: async ({ interaction, t, services }) => {
    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) {
      throw new PreconditionError('Nur Textkanaele koennen gesperrt werden');
    }
    assertBotPermission(
      interaction.guild!, MODERATION_PERMISSIONS.manageChannels.flag, MODERATION_PERMISSIONS.manageChannels.label,
    );
    await channel.permissionOverwrites.edit(interaction.guild!.roles.everyone, { SendMessages: false }, {
      reason: interaction.options.getString('reason') ?? `Lock via NEXUS — ${interaction.user.tag}`,
    });
    await writeAudit(services, {
      guildId: interaction.guildId!, actorId: interaction.user.id, actorType: 'discord',
      action: 'moderation.lock', targetId: channel.id, targetType: 'channel',
      result: 'SUCCESS', reason: interaction.options.getString('reason'), metadata: {},
    });
    await interaction.reply({ embeds: [embeds.success(t('moderation.lockSuccess'))] });
  },
};

export const unlock: SlashCommand = {
  category: 'moderation',
  permission: 'discord.moderation.channel',
  moduleToggle: 'moderationEnabled',
  data: new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Hebt die Sperre des aktuellen Kanals auf')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  execute: async ({ interaction, t, services }) => {
    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) {
      throw new PreconditionError('Nur Textkanaele koennen entsperrt werden');
    }
    await channel.permissionOverwrites.edit(interaction.guild!.roles.everyone, { SendMessages: null }, {
      reason: `Unlock via NEXUS — ${interaction.user.tag}`,
    });
    await writeAudit(services, {
      guildId: interaction.guildId!, actorId: interaction.user.id, actorType: 'discord',
      action: 'moderation.unlock', targetId: channel.id, targetType: 'channel',
      result: 'SUCCESS', reason: null, metadata: {},
    });
    await interaction.reply({ embeds: [embeds.success(t('moderation.unlockSuccess'))] });
  },
};

export const nick: SlashCommand = {
  category: 'moderation',
  permission: 'discord.moderation.nick',
  moduleToggle: 'moderationEnabled',
  data: new SlashCommandBuilder()
    .setName('nick')
    .setDescription('Aendert den Nickname eines Mitglieds')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .addUserOption((option) => option.setName('user').setDescription('Zielnutzer').setRequired(true))
    .addStringOption((option) => option.setName('nickname').setDescription('Neuer Nickname (leer = zuruecksetzen)').setMaxLength(32)),
  execute: async ({ interaction, t, services }) => {
    const target = interaction.options.getUser('user', true);
    const nickname = interaction.options.getString('nickname');
    const member = await interaction.guild!.members.fetch(target.id);
    assertBotPermission(
      interaction.guild!, MODERATION_PERMISSIONS.manageNicknames.flag, MODERATION_PERMISSIONS.manageNicknames.label,
    );

    await interaction.deferReply();
    const previous = member.nickname;
    await member.setNickname(nickname, `Nickname via NEXUS — ${interaction.user.tag}`);
    await ModerationService.execute({
      services,
      guild: interaction.guild!,
      moderator: interaction.member as GuildMember,
      target,
      targetMember: member,
      action: 'NICK',
      reason: `Nickname: "${previous ?? '—'}" → "${nickname ?? '—'}"`,
      notify: false,
      metadata: { previousNickname: previous, newNickname: nickname },
    });
    await interaction.editReply({ embeds: [embeds.success(t('moderation.nickSuccess', { user: target.tag }))] });
  },
};

export const role: SlashCommand = {
  category: 'moderation',
  permission: 'discord.moderation.role',
  moduleToggle: 'moderationEnabled',
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Weist Rollen zu oder entfernt sie')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Weist eine Rolle zu')
        .addUserOption((option) => option.setName('user').setDescription('Zielnutzer').setRequired(true))
        .addRoleOption((option) => option.setName('role').setDescription('Rolle').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Entfernt eine Rolle')
        .addUserOption((option) => option.setName('user').setDescription('Zielnutzer').setRequired(true))
        .addRoleOption((option) => option.setName('role').setDescription('Rolle').setRequired(true)),
    ),
  execute: async ({ interaction, t, services }) => {
    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser('user', true);
    const targetRole = interaction.options.getRole('role', true);
    const guild = interaction.guild!;
    const member = await guild.members.fetch(target.id);
    const botMember = guild.members.me!;
    const executor = interaction.member as GuildMember;

    assertBotPermission(guild, MODERATION_PERMISSIONS.manageRoles.flag, MODERATION_PERMISSIONS.manageRoles.label);

    // Rollenhierarchie: weder Bot noch Moderator duerfen hoehere Rollen vergeben.
    if (targetRole.position >= botMember.roles.highest.position) {
      throw new PreconditionError('Diese Rolle steht ueber meiner hoechsten Rolle');
    }
    if (executor.id !== guild.ownerId && targetRole.position >= executor.roles.highest.position) {
      throw new PreconditionError('Du kannst keine Rolle vergeben, die gleich hoch oder hoeher als deine ist');
    }

    await interaction.deferReply();
    if (sub === 'add') {
      await member.roles.add(targetRole.id, `Rolle via NEXUS — ${interaction.user.tag}`);
    } else {
      await member.roles.remove(targetRole.id, `Rolle via NEXUS — ${interaction.user.tag}`);
    }

    await ModerationService.execute({
      services,
      guild,
      moderator: executor,
      target,
      targetMember: member,
      action: sub === 'add' ? 'ROLE_ADD' : 'ROLE_REMOVE',
      reason: `Rolle ${targetRole.name}`,
      notify: false,
      metadata: { roleId: targetRole.id, roleName: targetRole.name },
    });

    await interaction.editReply({
      embeds: [
        embeds.success(
          t(sub === 'add' ? 'moderation.roleAdded' : 'moderation.roleRemoved', {
            role: targetRole.name, user: target.tag,
          }),
        ),
      ],
    });
  },
};

export const note: SlashCommand = {
  category: 'moderation',
  permission: 'discord.moderation.note',
  moduleToggle: 'moderationEnabled',
  data: new SlashCommandBuilder()
    .setName('note')
    .setDescription('Speichert eine interne Notiz zu einem Nutzer')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) => option.setName('user').setDescription('Zielnutzer').setRequired(true))
    .addStringOption((option) => option.setName('content').setDescription('Notiz').setRequired(true).setMaxLength(500)),
  execute: async ({ interaction, t, services }) => {
    const target = interaction.options.getUser('user', true);
    const content = interaction.options.getString('content', true);
    await interaction.deferReply({ ephemeral: true });
    const entry = await ModerationService.execute({
      services,
      guild: interaction.guild!,
      moderator: interaction.member as GuildMember,
      target,
      action: 'NOTE',
      reason: content,
      notify: false,
    });
    await interaction.editReply({
      embeds: [embeds.success(t('moderation.noteSuccess', { user: target.tag, case: entry.caseId }))],
    });
  },
};

export const modhistory: SlashCommand = {
  category: 'moderation',
  permission: 'discord.moderation.view',
  moduleToggle: 'moderationEnabled',
  data: new SlashCommandBuilder()
    .setName('modhistory')
    .setDescription('Zeigt die Moderationshistorie eines Nutzers')
    .addUserOption((option) => option.setName('user').setDescription('Zielnutzer').setRequired(true))
    .addIntegerOption((option) => option.setName('page').setDescription('Seite').setMinValue(1)),
  execute: async ({ interaction, t, services }) => {
    const target = interaction.options.getUser('user', true);
    const page = interaction.options.getInteger('page') ?? 1;
    const result = await services.store.moderation.listCases(interaction.guildId!, {
      targetId: target.id, page, pageSize: 10,
    });

    if (result.items.length === 0) {
      await interaction.reply({ embeds: [embeds.info(t('moderation.noCases'))], ephemeral: true });
      return;
    }

    const description = result.items
      .map(
        (entry) =>
          `\`${entry.caseId}\` ${ModerationService.label(entry.action)} · <@${entry.moderatorId}>\n` +
          `${truncate(entry.reason, 120)} — ${discordTimestamp(entry.createdAt, 'R')}`,
      )
      .join('\n\n');

    await interaction.reply({
      embeds: [
        embeds
          .primary(`📚 ${target.tag}`, description)
          .setFooter({
            text: t('common.page', { page: result.page, total: Math.max(1, Math.ceil(result.total / result.pageSize)) }),
          }),
      ],
    });
  },
};

export const caseCommand: SlashCommand = {
  category: 'moderation',
  permission: 'discord.moderation.view',
  moduleToggle: 'moderationEnabled',
  data: new SlashCommandBuilder()
    .setName('case')
    .setDescription('Zeigt einen Moderationsfall')
    .addStringOption((option) => option.setName('id').setDescription('Fall-ID, z. B. NX-4821-000137').setRequired(true)),
  execute: async ({ interaction, t, services }) => {
    const caseId = interaction.options.getString('id', true);
    const entry = await services.store.moderation.getCase(interaction.guildId!, caseId);
    if (!entry) {
      await interaction.reply({
        embeds: [embeds.warning(t('common.notFound', { resource: `Fall ${caseId}` }))],
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      embeds: [
        embeds
          .primary(t('moderation.caseTitle', { case: entry.caseId }), ModerationService.label(entry.action))
          .addFields(
            { name: t('moderation.target'), value: `<@${entry.targetId}>\n\`${entry.targetId}\``, inline: true },
            { name: t('moderation.moderator'), value: `<@${entry.moderatorId}>`, inline: true },
            { name: t('moderation.date'), value: discordTimestamp(entry.createdAt, 'f'), inline: true },
            { name: t('moderation.reason'), value: truncate(entry.reason, 1024) },
            {
              name: 'Status',
              value: entry.revoked ? '↩️ Zurueckgenommen' : entry.active ? '🟢 Aktiv' : '⚪ Abgeschlossen',
              inline: true,
            },
            { name: 'Quelle', value: entry.source, inline: true },
            ...(entry.durationMs
              ? [{ name: t('moderation.duration'), value: formatDuration(entry.durationMs, 3), inline: true }]
              : []),
          ),
      ],
    });
  },
};

export const moderationCommands: SlashCommand[] = [
  ban, unban, kick, softban, timeout, untimeout, warn, warnings, clear,
  slowmode, lock, unlock, nick, role, note, modhistory, caseCommand,
];

export { reasonOption };
