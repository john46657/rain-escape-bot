import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } from 'discord.js';
import { customId, embeds, type NexusModule, type Services, type SlashCommand } from '@nexus/bot-core';
import type { GiveawayEntity } from '@nexus/database';
import { PreconditionError, discordTimestamp, parseDuration, randomInt } from '@nexus/shared';

/**
 * Modul: Gewinnspiele (Regel 16).
 * Teilnahme per Button, Ziehung durch den Scheduler, Reroll moeglich.
 */

function drawWinners(entries: string[], count: number, exclude: string[] = []): string[] {
  const pool = entries.filter((entry) => !exclude.includes(entry));
  const winners: string[] = [];
  while (winners.length < count && pool.length > 0) {
    winners.push(...pool.splice(randomInt(0, pool.length - 1), 1));
  }
  return winners;
}

async function finish(
  services: Services,
  giveaway: GiveawayEntity,
  rerollExclude: string[] = [],
): Promise<string[]> {
  const winners = drawWinners(giveaway.entries, giveaway.winnerCount, rerollExclude);
  await services.store.giveaways.finish(giveaway.id, winners);

  const guild = services.client.guilds.cache.get(giveaway.guildId);
  const channel = guild ? await guild.channels.fetch(giveaway.channelId).catch(() => null) : null;
  if (channel?.isTextBased()) {
    await channel
      .send({
        content: winners.map((id) => `<@${id}>`).join(' ') || undefined,
        embeds: [
          winners.length > 0
            ? embeds.success(
                `**${giveaway.prize}**\n\nGewinner: ${winners.map((id) => `<@${id}>`).join(', ')}`,
                '🎉 Gewinnspiel beendet',
              )
            : embeds.warning('Es gab keine Teilnehmer.', '🎉 Gewinnspiel beendet'),
        ],
      })
      .catch(() => undefined);
  }
  await services.publish('giveaway.ended', { guildId: giveaway.guildId, giveawayId: giveaway.id, winners });
  return winners;
}

const giveaway: SlashCommand = {
  category: 'giveaways',
  permission: 'discord.giveaways.manage',
  moduleToggle: 'giveawaysEnabled',
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Gewinnspiele verwalten')
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Startet ein Gewinnspiel')
        .addStringOption((option) =>
          option.setName('prize').setDescription('Gewinn').setRequired(true).setMaxLength(200),
        )
        .addStringOption((option) =>
          option.setName('duration').setDescription('Laufzeit, z. B. 2h').setRequired(true),
        )
        .addIntegerOption((option) =>
          option.setName('winners').setDescription('Anzahl Gewinner').setMinValue(1).setMaxValue(20),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('end')
        .setDescription('Beendet ein Gewinnspiel sofort')
        .addStringOption((option) => option.setName('id').setDescription('Giveaway-ID').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('reroll')
        .setDescription('Zieht neue Gewinner')
        .addStringOption((option) => option.setName('id').setDescription('Giveaway-ID').setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Zeigt laufende Gewinnspiele')),
  execute: async ({ interaction, services }) => {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId!;

    if (sub === 'create') {
      const prize = interaction.options.getString('prize', true);
      const durationMs = parseDuration(interaction.options.getString('duration', true));
      if (!durationMs) throw new PreconditionError('Ungueltige Laufzeit');
      const winnerCount = interaction.options.getInteger('winners') ?? 1;

      const entity = await services.store.giveaways.create({
        guildId,
        channelId: interaction.channelId,
        messageId: null,
        hostId: interaction.user.id,
        prize,
        description: null,
        winnerCount,
        endsAt: new Date(Date.now() + durationMs),
        requirements: {},
      });

      const message = await interaction.reply({
        embeds: [
          embeds
            .primary(
              `🎉 ${prize}`,
              `Endet ${discordTimestamp(entity.endsAt, 'R')}\nGewinner: **${winnerCount}**`,
            )
            .setFooter({ text: `ID ${entity.id.slice(0, 8)} · veranstaltet von ${interaction.user.tag}` }),
        ],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(customId('giveaway', 'join', entity.id))
              .setLabel('Teilnehmen')
              .setEmoji('🎉')
              .setStyle(ButtonStyle.Primary),
          ),
        ],
        fetchReply: true,
      });
      await services.store.giveaways.setMessage(entity.id, message.id);
      return;
    }

    if (sub === 'list') {
      const list = await services.store.giveaways.list(guildId, false);
      await interaction.reply({
        embeds: [
          embeds.primary(
            'Laufende Gewinnspiele',
            list
              .map(
                (entry) =>
                  `\`${entry.id.slice(0, 8)}\` **${entry.prize}** — endet ${discordTimestamp(entry.endsAt, 'R')} (${entry.entries.length} Teilnehmer)`,
              )
              .join('\n') || 'Keine laufenden Gewinnspiele.',
          ),
        ],
        ephemeral: true,
      });
      return;
    }

    const id = interaction.options.getString('id', true);
    const entity = (await services.store.giveaways.list(guildId)).find((entry) => entry.id.startsWith(id));
    if (!entity) throw new PreconditionError('Gewinnspiel nicht gefunden');

    await interaction.deferReply({ ephemeral: true });
    const winners = await finish(services, entity, sub === 'reroll' ? entity.winners : []);
    await interaction.editReply({
      embeds: [
        embeds.success(
          winners.length > 0 ? `Gewinner: ${winners.map((w) => `<@${w}>`).join(', ')}` : 'Keine Teilnehmer.',
        ),
      ],
    });
  },
};

const giveawaysModule: NexusModule = {
  name: 'giveaways',
  description: 'Gewinnspiele mit Button-Teilnahme',
  commands: [giveaway],
  components: [
    {
      id: 'giveaway',
      kind: 'button',
      cooldownMs: 2_000,
      execute: async ({ interaction, services, args }) => {
        if (!interaction.isButton()) return;
        const entity = await services.store.giveaways.get(args[1] ?? '');
        if (!entity || entity.ended) {
          await interaction.reply({
            embeds: [embeds.warning('Dieses Gewinnspiel ist beendet.')],
            ephemeral: true,
          });
          return;
        }
        const result = await services.store.giveaways.addEntry(entity.id, interaction.user.id);
        await interaction.reply({
          embeds: [
            result.added
              ? embeds.success(`Teilnahme bestaetigt! (${result.total} Teilnehmer)`)
              : embeds.info('Du nimmst bereits teil.'),
          ],
          ephemeral: true,
        });
      },
    },
  ],
  jobs: [
    {
      name: 'giveaways:draw',
      intervalMs: 30_000,
      singleton: true,
      execute: async (services) => {
        for (const entity of await services.store.giveaways.listDue(new Date())) {
          await finish(services, entity).catch((error: unknown) =>
            services.log.error('Ziehung fehlgeschlagen', error, { giveawayId: entity.id }),
          );
        }
      },
    },
  ],
};

export default giveawaysModule;
