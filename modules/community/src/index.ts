import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, SlashCommandBuilder } from 'discord.js';
import { customId, embeds, truncate, type NexusModule, type SlashCommand } from '@nexus/bot-core';
import { discordTimestamp } from '@nexus/shared';

/**
 * Modul: Community (Regeln 10-11).
 * Willkommensnachrichten, Autorollen, Vorschlaege, Umfragen und Starboard.
 */

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => vars[key] ?? `{${key}}`);
}

const suggest: SlashCommand = {
  category: 'community',
  cooldownMs: 60_000,
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Reicht einen Vorschlag ein')
    .addStringOption((option) =>
      option.setName('text').setDescription('Dein Vorschlag').setRequired(true).setMaxLength(1000),
    ),
  execute: async ({ interaction, services, config, t }) => {
    const text = interaction.options.getString('text', true);
    const channelId = config?.suggestionChannelId;
    if (!channelId) {
      await interaction.reply({
        embeds: [embeds.warning('Es ist kein Vorschlagskanal konfiguriert (Dashboard → Community).')],
        ephemeral: true,
      });
      return;
    }

    const channel = await interaction.guild?.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) {
      await interaction.reply({
        embeds: [embeds.warning(t('common.notFound', { resource: 'Vorschlagskanal' }))],
        ephemeral: true,
      });
      return;
    }

    const message = await channel.send({
      embeds: [
        embeds
          .primary('💡 Neuer Vorschlag', truncate(text, 4000))
          .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
          .addFields({ name: 'Abstimmung', value: '👍 0 · 👎 0' }),
      ],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(customId('suggest', 'up'))
            .setEmoji('👍')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(customId('suggest', 'down'))
            .setEmoji('👎')
            .setStyle(ButtonStyle.Danger),
        ),
      ],
    });

    await services.publish('community.suggestion', {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      messageId: message.id,
    });
    await interaction.reply({
      embeds: [embeds.success(`Vorschlag eingereicht: ${message.url}`)],
      ephemeral: true,
    });
  },
};

const poll: SlashCommand = {
  category: 'community',
  permission: 'discord.community.manage',
  cooldownMs: 10_000,
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Erstellt eine Umfrage')
    .addStringOption((option) =>
      option.setName('question').setDescription('Frage').setRequired(true).setMaxLength(300),
    )
    .addStringOption((option) =>
      option.setName('options').setDescription('Antworten, durch | getrennt (max. 5)').setRequired(true),
    ),
  execute: async ({ interaction }) => {
    const question = interaction.options.getString('question', true);
    const options = interaction.options
      .getString('options', true)
      .split('|')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 5);
    const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

    const message = await interaction.reply({
      embeds: [
        embeds.primary(
          `📊 ${question}`,
          options.map((option, index) => `${emojis[index]} ${option}`).join('\n'),
        ),
      ],
      fetchReply: true,
    });
    for (let index = 0; index < options.length; index++) {
      await message.react(emojis[index]!).catch(() => undefined);
    }
  },
};

const afk: SlashCommand = {
  category: 'community',
  cooldownMs: 10_000,
  data: new SlashCommandBuilder()
    .setName('afk')
    .setDescription('Markiert dich als abwesend')
    .addStringOption((option) => option.setName('reason').setDescription('Grund').setMaxLength(200)),
  execute: async ({ interaction, services }) => {
    const reason = interaction.options.getString('reason') ?? 'AFK';
    await services.cache.setJson(
      `afk:${interaction.guildId}:${interaction.user.id}`,
      { reason, since: Date.now() },
      24 * 60 * 60 * 1000,
    );
    await interaction.reply({
      embeds: [embeds.success(`Du bist jetzt als AFK markiert: ${reason}`)],
      ephemeral: true,
    });
  },
};

const communityModule: NexusModule = {
  name: 'community',
  description: 'Willkommen, Autorollen, Vorschlaege, Umfragen und Starboard',
  commands: [suggest, poll, afk],
  components: [
    {
      id: 'suggest',
      kind: 'button',
      cooldownMs: 2_000,
      execute: async ({ interaction, services, args }) => {
        if (!interaction.isButton()) return;
        const direction = args[0] === 'up' ? 'up' : 'down';
        // Eine Stimme je Nutzer und Vorschlag.
        const first = await services.cache.markOnce(
          `suggest:${interaction.message.id}`,
          interaction.user.id,
          30 * 24 * 60 * 60 * 1000,
        );
        if (!first) {
          await interaction.reply({
            embeds: [embeds.warning('Du hast bereits abgestimmt.')],
            ephemeral: true,
          });
          return;
        }
        const votes = await services.cache.increment(
          `suggest:votes:${interaction.message.id}:${direction}`,
          1,
        );
        await interaction.reply({
          embeds: [embeds.success(`Stimme gezaehlt (${direction === 'up' ? '👍' : '👎'} ${votes}).`)],
          ephemeral: true,
        });
      },
    },
  ],
  events: [
    {
      event: Events.GuildMemberAdd,
      execute: async (services, member) => {
        const config = await services.guildContext.config(member.guild.id);

        for (const roleId of config.autoRoleIds) {
          await member.roles.add(roleId, 'NEXUS Autorolle').catch(() => undefined);
        }

        if (!config.welcomeChannelId || !config.welcomeMessage) return;
        const channel = await member.guild.channels.fetch(config.welcomeChannelId).catch(() => null);
        if (!channel?.isTextBased()) return;

        await channel
          .send({
            embeds: [
              embeds
                .success(
                  renderTemplate(config.welcomeMessage, {
                    user: `<@${member.id}>`,
                    username: member.user.username,
                    server: member.guild.name,
                    memberCount: String(member.guild.memberCount),
                  }),
                  `Willkommen auf ${member.guild.name}`,
                )
                .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
                .addFields({
                  name: 'Konto erstellt',
                  value: discordTimestamp(member.user.createdAt, 'R'),
                  inline: true,
                }),
            ],
          })
          .catch(() => undefined);
      },
    },
    {
      event: Events.GuildMemberRemove,
      execute: async (services, member) => {
        const config = await services.guildContext.config(member.guild.id);
        if (!config.goodbyeChannelId || !config.goodbyeMessage) return;
        const channel = await member.guild.channels.fetch(config.goodbyeChannelId).catch(() => null);
        if (!channel?.isTextBased()) return;
        await channel
          .send({
            embeds: [
              embeds.info(
                renderTemplate(config.goodbyeMessage, {
                  user: member.user.tag,
                  username: member.user.username,
                  server: member.guild.name,
                  memberCount: String(member.guild.memberCount),
                }),
              ),
            ],
          })
          .catch(() => undefined);
      },
    },
    {
      // Starboard: Nachrichten mit genuegend Sternen werden gesammelt.
      event: Events.MessageReactionAdd,
      execute: async (services, reaction) => {
        if (reaction.emoji.name !== '⭐') return;
        const message = reaction.message.partial
          ? await reaction.message.fetch().catch(() => null)
          : reaction.message;
        if (!message?.inGuild()) return;

        const config = await services.guildContext.config(message.guildId);
        if (!config.starboardChannelId || (reaction.count ?? 0) < config.starboardThreshold) return;

        const isNew = await services.cache.markOnce('starboard', message.id, 7 * 24 * 60 * 60 * 1000);
        if (!isNew) return;

        const channel = await message.guild.channels.fetch(config.starboardChannelId).catch(() => null);
        if (!channel?.isTextBased()) return;

        await channel
          .send({
            embeds: [
              embeds
                .primary(`⭐ ${reaction.count}`, truncate(message.content || '(kein Text)', 2000))
                .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
                .addFields({ name: 'Original', value: `[Zur Nachricht](${message.url})` })
                .setImage(message.attachments.first()?.url ?? null),
            ],
          })
          .catch(() => undefined);
      },
    },
    {
      // AFK-Rueckmeldung beim naechsten Beitrag.
      event: Events.MessageCreate,
      execute: async (services, message) => {
        if (!message.inGuild() || message.author.bot) return;
        const key = `afk:${message.guildId}:${message.author.id}`;
        const entry = await services.cache.getJson<{ reason: string; since: number }>(key);
        if (!entry) return;
        await services.cache.delete(key);
        const reply = await message
          .reply({
            embeds: [embeds.info(`Willkommen zurueck — deine AFK-Markierung wurde entfernt.`)],
          })
          .catch(() => null);
        setTimeout(() => void reply?.delete().catch(() => undefined), 10_000);
      },
    },
  ],
};

export default communityModule;
