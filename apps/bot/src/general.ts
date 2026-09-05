/**
 * Allgemeine Befehle (Regel 4).
 * Bewusst Teil des Bot-Kerns, da sie kein fachliches Modul benoetigen.
 */
import {
  ActionRowBuilder, ChannelType, EmbedBuilder, SlashCommandBuilder, StringSelectMenuBuilder,
  version as djsVersion,
} from 'discord.js';
import { BRAND, discordTimestamp, formatDuration } from '@nexus/shared';
import { embeds, truncate } from './core/embeds.js';
import { COMMAND_CATEGORIES, customId, type NexusModule, type SlashCommand } from './core/types.js';

const CATEGORY_LABELS: Record<string, { de: string; en: string; emoji: string }> = {
  general: { de: 'Allgemein', en: 'General', emoji: '🧭' },
  moderation: { de: 'Moderation', en: 'Moderation', emoji: '🔨' },
  security: { de: 'Sicherheit', en: 'Security', emoji: '🛡️' },
  tickets: { de: 'Tickets', en: 'Tickets', emoji: '🎫' },
  community: { de: 'Community', en: 'Community', emoji: '💬' },
  levels: { de: 'Level', en: 'Levels', emoji: '📈' },
  economy: { de: 'Wirtschaft', en: 'Economy', emoji: '⬢' },
  games: { de: 'Spiele', en: 'Games', emoji: '🎲' },
  giveaways: { de: 'Gewinnspiele', en: 'Giveaways', emoji: '🎉' },
  music: { de: 'Musik', en: 'Music', emoji: '🎵' },
  roblox: { de: 'Roblox', en: 'Roblox', emoji: '🟥' },
  automation: { de: 'Automation', en: 'Automation', emoji: '⚙️' },
  analytics: { de: 'Analytics', en: 'Analytics', emoji: '📊' },
  backup: { de: 'Backups', en: 'Backups', emoji: '💾' },
  ai: { de: 'KI', en: 'AI', emoji: '🤖' },
  admin: { de: 'Administration', en: 'Administration', emoji: '🔧' },
};

const help: SlashCommand = {
  category: 'general',
  guildOnly: false,
  cooldownMs: 3_000,
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Zeigt alle Befehle von NEXUS')
    .setDescriptionLocalizations({ 'en-US': 'Shows all NEXUS commands' }),
  execute: async ({ interaction, t, locale }) => {
    const select = new StringSelectMenuBuilder()
      .setCustomId(customId('help', 'category'))
      .setPlaceholder(t('general.helpSelect'))
      .addOptions(
        COMMAND_CATEGORIES.map((category) => ({
          label: CATEGORY_LABELS[category]?.[locale] ?? category,
          value: category,
          emoji: CATEGORY_LABELS[category]?.emoji,
        })),
      );

    await interaction.reply({
      embeds: [
        embeds
          .primary(t('general.helpTitle'), t('general.helpDescription'))
          .addFields({
            name: BRAND.tagline,
            value:
              locale === 'de'
                ? 'NEXUS verbindet deinen Discord-Server mit deinen Roblox-Spielen: Moderation, Sicherheit, Tickets, Level, Wirtschaft, Verifizierung, Live-Server und Automationen.'
                : 'NEXUS connects your Discord server with your Roblox games: moderation, security, tickets, levels, economy, verification, live servers and automations.',
          }),
      ],
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    });
  },
};

const ping: SlashCommand = {
  category: 'general',
  guildOnly: false,
  cooldownMs: 5_000,
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Zeigt die Latenz von Bot, Datenbank und Cache')
    .setDescriptionLocalizations({ 'en-US': 'Shows bot, database and cache latency' }),
  execute: async ({ interaction, services, t }) => {
    const sent = Date.now();
    await interaction.deferReply();

    const dbStart = Date.now();
    const dbHealthy = await services.store.healthy();
    const dbLatency = Date.now() - dbStart;

    const cacheStart = Date.now();
    const cacheHealthy = await services.cache.healthy();
    const cacheLatency = Date.now() - cacheStart;

    const status = (healthy: boolean, latency: number): string =>
      `${healthy ? '🟢' : '🔴'} ${latency}ms`;

    await interaction.editReply({
      embeds: [
        embeds.primary(`🏓 ${t('general.pingTitle')}`).addFields(
          { name: t('general.pingGateway'), value: `🟢 ${Math.max(0, Math.round(services.client.ws.ping))}ms`, inline: true },
          { name: t('general.pingRoundtrip'), value: `🟢 ${Date.now() - sent}ms`, inline: true },
          { name: t('general.pingDatabase'), value: status(dbHealthy, dbLatency), inline: true },
          { name: t('general.pingCache'), value: status(cacheHealthy, cacheLatency), inline: true },
        ),
      ],
    });
  },
};

const botinfo: SlashCommand = {
  category: 'general',
  guildOnly: false,
  cooldownMs: 10_000,
  data: new SlashCommandBuilder()
    .setName('botinfo')
    .setDescription('Zeigt Informationen ueber NEXUS')
    .setDescriptionLocalizations({ 'en-US': 'Shows information about NEXUS' }),
  execute: async ({ interaction, services, t }) => {
    const memory = process.memoryUsage().heapUsed / 1024 / 1024;
    const guilds = services.client.guilds.cache.size;
    const users = services.client.guilds.cache.reduce((sum, guild) => sum + guild.memberCount, 0);

    await interaction.reply({
      embeds: [
        embeds
          .primary(t('general.botinfoTitle'), BRAND.tagline)
          .setThumbnail(services.client.user?.displayAvatarURL() ?? null)
          .addFields(
            { name: t('general.uptime'), value: formatDuration(process.uptime() * 1000, 3), inline: true },
            { name: t('general.guilds'), value: guilds.toLocaleString('de-DE'), inline: true },
            { name: t('general.users'), value: users.toLocaleString('de-DE'), inline: true },
            { name: t('general.memory'), value: `${memory.toFixed(1)} MB`, inline: true },
            { name: t('general.shard'), value: `${services.client.shard?.ids[0] ?? 0}`, inline: true },
            { name: 'Runtime', value: `Node ${process.version} · discord.js ${djsVersion}`, inline: true },
            {
              name: 'Infrastruktur',
              value: `Datenspeicher: \`${services.store.kind}\` · Cache: \`${services.cache.kind}\``,
            },
          ),
      ],
    });
  },
};

const serverinfo: SlashCommand = {
  category: 'general',
  cooldownMs: 5_000,
  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Zeigt Informationen ueber diesen Server')
    .setDescriptionLocalizations({ 'en-US': 'Shows information about this server' }),
  execute: async ({ interaction, services }) => {
    const guild = interaction.guild;
    if (!guild) return;

    const channels = guild.channels.cache;
    const stored = await services.store.guilds.findByDiscordId(guild.id);
    const cases = await services.store.moderation.listCases(guild.id, { pageSize: 1 });

    await interaction.reply({
      embeds: [
        embeds
          .primary(guild.name)
          .setThumbnail(guild.iconURL({ size: 256 }))
          .addFields(
            { name: 'Server-ID', value: `\`${guild.id}\``, inline: true },
            { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
            { name: 'Erstellt', value: discordTimestamp(guild.createdAt, 'D'), inline: true },
            { name: 'Mitglieder', value: guild.memberCount.toLocaleString('de-DE'), inline: true },
            { name: 'Rollen', value: String(guild.roles.cache.size), inline: true },
            { name: 'Boosts', value: `${guild.premiumSubscriptionCount ?? 0} (Stufe ${guild.premiumTier})`, inline: true },
            {
              name: 'Kanaele',
              value: [
                `💬 ${channels.filter((c) => c.type === ChannelType.GuildText).size} Text`,
                `🔊 ${channels.filter((c) => c.type === ChannelType.GuildVoice).size} Voice`,
                `📂 ${channels.filter((c) => c.type === ChannelType.GuildCategory).size} Kategorien`,
              ].join(' · '),
            },
            {
              name: 'NEXUS',
              value: [
                `Tarif: **${stored?.premiumTier ?? 'FREE'}**`,
                `Moderationsfaelle: **${cases.total}**`,
                `Verifizierungsstufe: **${guild.verificationLevel}**`,
              ].join('\n'),
            },
          ),
      ],
    });
  },
};

const userinfo: SlashCommand = {
  category: 'general',
  cooldownMs: 5_000,
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Zeigt Informationen ueber einen Nutzer')
    .setDescriptionLocalizations({ 'en-US': 'Shows information about a user' })
    .addUserOption((option) =>
      option.setName('user').setDescription('Zielnutzer').setDescriptionLocalizations({ 'en-US': 'Target user' }),
    ),
  execute: async ({ interaction, services }) => {
    const user = interaction.options.getUser('user') ?? interaction.user;
    const member = interaction.guild ? await interaction.guild.members.fetch(user.id).catch(() => null) : null;

    const embed = new EmbedBuilder()
      .setColor(member?.displayColor || BRAND.colors.primary)
      .setTitle(user.tag)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'ID', value: `\`${user.id}\``, inline: true },
        { name: 'Konto erstellt', value: discordTimestamp(user.createdAt, 'R'), inline: true },
      )
      .setTimestamp(new Date());

    if (member) {
      const roles = member.roles.cache
        .filter((role) => role.id !== interaction.guildId)
        .sort((a, b) => b.position - a.position)
        .map((role) => role.toString());
      embed.addFields(
        { name: 'Beigetreten', value: member.joinedAt ? discordTimestamp(member.joinedAt, 'R') : '—', inline: true },
        { name: `Rollen (${roles.length})`, value: truncate(roles.join(' ') || '—', 1024) },
      );
      if (member.communicationDisabledUntil) {
        embed.addFields({
          name: '⏳ Timeout bis',
          value: discordTimestamp(member.communicationDisabledUntil, 'R'),
        });
      }
    }

    if (interaction.guildId) {
      const [warnings, robloxAccount, xp] = await Promise.all([
        services.store.moderation.listWarnings(interaction.guildId, user.id),
        services.store.roblox.getAccountByDiscordId(user.id),
        services.store.levels.getProfile(interaction.guildId, user.id),
      ]);
      embed.addFields({
        name: 'NEXUS',
        value: [
          `Verwarnungen: **${warnings.length}**`,
          `Level: **${xp.level}** (${xp.totalXp.toLocaleString('de-DE')} XP)`,
          robloxAccount
            ? `Roblox: **${robloxAccount.username}** (\`${robloxAccount.robloxUserId}\`) ✅`
            : 'Roblox: *nicht verknuepft*',
        ].join('\n'),
      });
    }

    await interaction.reply({ embeds: [embed] });
  },
};

const avatar: SlashCommand = {
  category: 'general',
  guildOnly: false,
  cooldownMs: 3_000,
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('Zeigt den Avatar eines Nutzers')
    .setDescriptionLocalizations({ 'en-US': "Shows a user's avatar" })
    .addUserOption((option) => option.setName('user').setDescription('Zielnutzer')),
  execute: async ({ interaction }) => {
    const user = interaction.options.getUser('user') ?? interaction.user;
    const url = user.displayAvatarURL({ size: 1024 });
    await interaction.reply({
      embeds: [embeds.primary(user.tag).setImage(url).setURL(url)],
    });
  },
};

const servericon: SlashCommand = {
  category: 'general',
  cooldownMs: 3_000,
  data: new SlashCommandBuilder()
    .setName('servericon')
    .setDescription('Zeigt das Server-Icon')
    .setDescriptionLocalizations({ 'en-US': 'Shows the server icon' }),
  execute: async ({ interaction, t }) => {
    const url = interaction.guild?.iconURL({ size: 1024 });
    if (!url) {
      await interaction.reply({ embeds: [embeds.warning(t('common.notFound', { resource: 'Server-Icon' }))] });
      return;
    }
    await interaction.reply({ embeds: [embeds.primary(interaction.guild!.name).setImage(url).setURL(url)] });
  },
};

export const generalModule: NexusModule = {
  name: 'general',
  description: 'Allgemeine Informationsbefehle',
  commands: [help, ping, botinfo, serverinfo, userinfo, avatar, servericon],
  components: [
    {
      id: 'help',
      kind: 'select',
      execute: async ({ interaction, locale }) => {
        if (!interaction.isStringSelectMenu()) return;
        const category = interaction.values[0] ?? 'general';
        const label = CATEGORY_LABELS[category]?.[locale] ?? category;
        // Die Befehlsliste wird aus den registrierten Anwendungsbefehlen gelesen,
        // damit Hilfe und tatsaechlicher Funktionsumfang nie auseinanderlaufen.
        const commands = await interaction.client.application?.commands.fetch();
        const description =
          commands
            ?.map((command) => `\`/${command.name}\` — ${command.description}`)
            .slice(0, 25)
            .join('\n') ?? '—';
        await interaction.update({
          embeds: [embeds.primary(`${CATEGORY_LABELS[category]?.emoji ?? ''} ${label}`, truncate(description, 4000))],
        });
      },
    },
  ],
};
