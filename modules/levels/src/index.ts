import { AttachmentBuilder, Events, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { embeds, progressBar, type NexusModule, type SlashCommand } from '@nexus/bot-core';
import { levelFromTotalXp, xpForLevel } from '@nexus/database';

/**
 * Modul: Level & XP (Regel 12).
 * XP pro Nachricht mit Cooldown, Rollenbelohnungen und Bestenliste.
 */

const rank: SlashCommand = {
  category: 'levels',
  moduleToggle: 'levelsEnabled',
  cooldownMs: 5_000,
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Zeigt deinen Level-Fortschritt')
    .addUserOption((option) => option.setName('user').setDescription('Anderer Nutzer')),
  execute: async ({ interaction, services, t }) => {
    const user = interaction.options.getUser('user') ?? interaction.user;
    const [profile, position] = await Promise.all([
      services.store.levels.getProfile(interaction.guildId!, user.id),
      services.store.levels.rankOf(interaction.guildId!, user.id),
    ]);
    const needed = xpForLevel(profile.level);

    await interaction.reply({
      embeds: [
        embeds
          .primary(t('levels.rankTitle', { user: user.username }))
          .setThumbnail(user.displayAvatarURL({ size: 128 }))
          .addFields(
            { name: t('levels.level'), value: String(profile.level), inline: true },
            { name: t('levels.rank'), value: `#${position}`, inline: true },
            { name: t('levels.xp'), value: `${profile.totalXp.toLocaleString('de-DE')}`, inline: true },
            { name: t('levels.progress'), value: `${progressBar(profile.xp, needed)}\n${profile.xp} / ${needed} XP` },
            { name: 'Nachrichten', value: profile.messages.toLocaleString('de-DE'), inline: true },
          ),
      ],
    });
  },
};

const leaderboard: SlashCommand = {
  category: 'levels',
  moduleToggle: 'levelsEnabled',
  cooldownMs: 10_000,
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Zeigt die XP-Bestenliste')
    .addIntegerOption((option) => option.setName('page').setDescription('Seite').setMinValue(1)),
  execute: async ({ interaction, services, t }) => {
    const page = interaction.options.getInteger('page') ?? 1;
    const entries = await services.store.levels.leaderboard(interaction.guildId!, 10, (page - 1) * 10);
    const medals = ['🥇', '🥈', '🥉'];

    await interaction.reply({
      embeds: [
        embeds.primary(
          `🏆 ${t('levels.leaderboardTitle')}`,
          entries
            .map(
              (entry) =>
                `${medals[entry.rank - 1] ?? `**${entry.rank}.**`} <@${entry.userId}> — ` +
                `Level **${entry.level}** (${entry.totalXp.toLocaleString('de-DE')} XP)`,
            )
            .join('\n') || 'Noch keine Daten.',
        ),
      ],
    });
  },
};

const xpAdmin: SlashCommand = {
  category: 'levels',
  permission: 'discord.levels.manage',
  moduleToggle: 'levelsEnabled',
  data: new SlashCommandBuilder()
    .setName('xp')
    .setDescription('Verwaltet XP')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Vergibt XP')
        .addUserOption((option) => option.setName('user').setDescription('Nutzer').setRequired(true))
        .addIntegerOption((option) => option.setName('amount').setDescription('Menge').setRequired(true).setMinValue(1)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Entzieht XP')
        .addUserOption((option) => option.setName('user').setDescription('Nutzer').setRequired(true))
        .addIntegerOption((option) => option.setName('amount').setDescription('Menge').setRequired(true).setMinValue(1)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('setlevel')
        .setDescription('Setzt das Level direkt')
        .addUserOption((option) => option.setName('user').setDescription('Nutzer').setRequired(true))
        .addIntegerOption((option) => option.setName('level').setDescription('Level').setRequired(true).setMinValue(0).setMaxValue(500)),
    ),
  execute: async ({ interaction, services, t }) => {
    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser('user', true);
    const guildId = interaction.guildId!;

    if (sub === 'setlevel') {
      const level = interaction.options.getInteger('level', true);
      const profile = await services.store.levels.setLevel(guildId, user.id, level);
      await interaction.reply({
        embeds: [embeds.success(`${user.username} ist jetzt Level **${profile.level}**.`)],
      });
      return;
    }

    const amount = interaction.options.getInteger('amount', true) * (sub === 'remove' ? -1 : 1);
    const result = await services.store.levels.addXp(guildId, user.id, amount);
    await interaction.reply({
      embeds: [
        embeds.success(
          t('levels.xpAdded', { amount, user: user.username }) +
            `\nNeues Level: **${result.profile.level}** (${result.profile.totalXp} XP)`,
        ),
      ],
    });
  },
};

const levelsModule: NexusModule = {
  name: 'levels',
  description: 'XP-System mit Levelbelohnungen',
  commands: [rank, leaderboard, xpAdmin],
  events: [
    {
      event: Events.MessageCreate,
      execute: async (services, message) => {
        if (!message.inGuild() || message.author.bot) return;
        const config = await services.guildContext.config(message.guildId);
        if (!config.levelsEnabled) return;
        if (config.xpIgnoredChannels.includes(message.channelId)) return;

        // Cooldown verhindert XP-Farming durch Nachrichten-Spam.
        const allowed = await services.cache.markOnce(
          'xp', `${message.guildId}:${message.author.id}`, config.xpCooldownSeconds * 1000,
        );
        if (!allowed) return;

        const gain = Math.round(config.xpPerMessage * config.xpMultiplier);
        const result = await services.store.levels.addXp(message.guildId, message.author.id, gain);
        if (!result.leveledUp) return;

        const rewards = await services.store.levels.listRewards(message.guildId);
        const earned = rewards.filter((reward) => reward.level <= result.profile.level);
        const member = message.member;

        for (const reward of earned) {
          if (reward.roleId && member && !member.roles.cache.has(reward.roleId)) {
            await member.roles.add(reward.roleId, `Level ${reward.level} erreicht`).catch(() => undefined);
          }
          if (reward.coins > 0) {
            await services.store.economy
              .mutate({
                guildId: message.guildId,
                userId: message.author.id,
                target: 'wallet',
                amount: reward.coins,
                type: 'REWARD',
                reason: `Levelbelohnung ${reward.level}`,
                idempotencyKey: `levelreward:${message.guildId}:${message.author.id}:${reward.level}`,
              })
              .catch(() => undefined);
          }
        }

        const channelId = config.levelUpChannelId ?? message.channelId;
        const channel = await message.guild.channels.fetch(channelId).catch(() => null);
        if (channel?.isTextBased()) {
          const template = config.levelUpMessage ?? 'Glueckwunsch {user}, du hast **Level {level}** erreicht!';
          await channel
            .send({
              embeds: [
                embeds.success(
                  template.replace('{user}', `<@${message.author.id}>`).replace('{level}', String(result.profile.level)),
                ),
              ],
            })
            .catch(() => undefined);
        }
        await services.publish('levels.levelup', {
          guildId: message.guildId, userId: message.author.id, level: result.profile.level,
        });
      },
    },
  ],
};

export default levelsModule;
export { levelFromTotalXp, xpForLevel };
export { AttachmentBuilder };
