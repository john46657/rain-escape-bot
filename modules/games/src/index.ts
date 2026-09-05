import { SlashCommandBuilder } from 'discord.js';
import { embeds, type NexusModule, type SlashCommand } from '@nexus/bot-core';
import { PreconditionError, randomInt, uuid } from '@nexus/shared';

/**
 * Modul: Spiele (Regel 15).
 * Alle Wetteinsaetze laufen ueber den Economy-Store — kein Zustand im Speicher.
 */

const coinflip: SlashCommand = {
  category: 'games',
  moduleToggle: 'gamesEnabled',
  cooldownMs: 5_000,
  data: new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('Muenzwurf mit optionalem Einsatz')
    .addStringOption((option) =>
      option
        .setName('side')
        .setDescription('Deine Wahl')
        .setRequired(true)
        .addChoices({ name: 'Kopf', value: 'heads' }, { name: 'Zahl', value: 'tails' }),
    )
    .addIntegerOption((option) => option.setName('bet').setDescription('Einsatz').setMinValue(1)),
  execute: async ({ interaction, services, config }) => {
    const side = interaction.options.getString('side', true);
    const bet = interaction.options.getInteger('bet') ?? 0;
    const guildId = interaction.guildId!;
    const symbol = config?.currencySymbol ?? '⬢';

    if (bet > 0) {
      await services.store.economy.mutate({
        guildId,
        userId: interaction.user.id,
        target: 'wallet',
        amount: -bet,
        type: 'GAMBLE',
        reason: 'Einsatz Coinflip',
        idempotencyKey: `cf:${uuid()}`,
      });
    }

    const result = randomInt(0, 1) === 0 ? 'heads' : 'tails';
    const won = result === side;
    if (won && bet > 0) {
      await services.store.economy.mutate({
        guildId,
        userId: interaction.user.id,
        target: 'wallet',
        amount: bet * 2,
        type: 'GAMBLE',
        reason: 'Gewinn Coinflip',
        idempotencyKey: `cf:${uuid()}`,
      });
    }

    await interaction.reply({
      embeds: [
        (won ? embeds.success : embeds.warning)(
          `Die Muenze zeigt **${result === 'heads' ? 'Kopf' : 'Zahl'}** — ${won ? 'du gewinnst!' : 'leider verloren.'}` +
            (bet > 0 ? `\nEinsatz: ${symbol} ${bet}${won ? ` · Gewinn: ${symbol} ${bet}` : ''}` : ''),
        ),
      ],
    });
  },
};

const dice: SlashCommand = {
  category: 'games',
  moduleToggle: 'gamesEnabled',
  cooldownMs: 3_000,
  data: new SlashCommandBuilder()
    .setName('dice')
    .setDescription('Wuerfelt')
    .addIntegerOption((option) =>
      option.setName('sides').setDescription('Seiten (Standard 6)').setMinValue(2).setMaxValue(1000),
    )
    .addIntegerOption((option) =>
      option.setName('count').setDescription('Anzahl (max. 10)').setMinValue(1).setMaxValue(10),
    ),
  execute: async ({ interaction }) => {
    const sides = interaction.options.getInteger('sides') ?? 6;
    const count = interaction.options.getInteger('count') ?? 1;
    const rolls = Array.from({ length: count }, () => randomInt(1, sides));
    await interaction.reply({
      embeds: [
        embeds.primary(
          '🎲 Wuerfel',
          `${rolls.map((roll) => `\`${roll}\``).join(' · ')}\n**Summe:** ${rolls.reduce((a, b) => a + b, 0)}`,
        ),
      ],
    });
  },
};

const slots: SlashCommand = {
  category: 'games',
  moduleToggle: 'gamesEnabled',
  cooldownMs: 8_000,
  data: new SlashCommandBuilder()
    .setName('slots')
    .setDescription('Einarmiger Bandit')
    .addIntegerOption((option) =>
      option.setName('bet').setDescription('Einsatz').setRequired(true).setMinValue(10),
    ),
  execute: async ({ interaction, services, config }) => {
    const bet = interaction.options.getInteger('bet', true);
    const guildId = interaction.guildId!;
    const symbols = ['🍒', '🍋', '🔔', '💎', '7️⃣'];
    const payouts: Record<string, number> = { '🍒': 3, '🍋': 4, '🔔': 6, '💎': 10, '7️⃣': 20 };

    await services.store.economy.mutate({
      guildId,
      userId: interaction.user.id,
      target: 'wallet',
      amount: -bet,
      type: 'GAMBLE',
      reason: 'Einsatz Slots',
      idempotencyKey: `slots:${uuid()}`,
    });

    const reels = [0, 1, 2].map(() => symbols[randomInt(0, symbols.length - 1)]!);
    const allEqual = reels[0] === reels[1] && reels[1] === reels[2];
    const twoEqual = !allEqual && new Set(reels).size === 2;
    const multiplier = allEqual ? (payouts[reels[0]!] ?? 3) : twoEqual ? 1.5 : 0;
    const payout = Math.floor(bet * multiplier);

    if (payout > 0) {
      await services.store.economy.mutate({
        guildId,
        userId: interaction.user.id,
        target: 'wallet',
        amount: payout,
        type: 'GAMBLE',
        reason: 'Gewinn Slots',
        idempotencyKey: `slots:${uuid()}`,
      });
    }

    await interaction.reply({
      embeds: [
        (payout > 0 ? embeds.success : embeds.warning)(
          `${reels.join(' | ')}\n\n${payout > 0 ? `Gewinn: ${config?.currencySymbol ?? '⬢'} ${payout}` : 'Kein Gewinn.'}`,
          '🎰 Slots',
        ),
      ],
    });
  },
};

const rps: SlashCommand = {
  category: 'games',
  moduleToggle: 'gamesEnabled',
  cooldownMs: 3_000,
  data: new SlashCommandBuilder()
    .setName('rps')
    .setDescription('Schere, Stein, Papier gegen NEXUS')
    .addStringOption((option) =>
      option
        .setName('choice')
        .setDescription('Deine Wahl')
        .setRequired(true)
        .addChoices(
          { name: 'Stein', value: 'rock' },
          { name: 'Papier', value: 'paper' },
          { name: 'Schere', value: 'scissors' },
        ),
    ),
  execute: async ({ interaction }) => {
    const choices = ['rock', 'paper', 'scissors'] as const;
    const labels: Record<string, string> = { rock: '🪨 Stein', paper: '📄 Papier', scissors: '✂️ Schere' };
    const player = interaction.options.getString('choice', true);
    const bot = choices[randomInt(0, 2)]!;
    const beats: Record<string, string> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

    const result =
      player === bot ? 'Unentschieden!' : beats[player] === bot ? 'Du gewinnst!' : 'NEXUS gewinnt!';
    await interaction.reply({
      embeds: [
        embeds.primary(
          'Schere, Stein, Papier',
          `Du: ${labels[player]}\nNEXUS: ${labels[bot]}\n\n**${result}**`,
        ),
      ],
    });
  },
};

const eightball: SlashCommand = {
  category: 'games',
  moduleToggle: 'gamesEnabled',
  cooldownMs: 3_000,
  data: new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('Stellt der magischen Kugel eine Frage')
    .addStringOption((option) => option.setName('question').setDescription('Deine Frage').setRequired(true)),
  execute: async ({ interaction }) => {
    const answers = [
      'Ja, ganz sicher.',
      'Eher nicht.',
      'Frag spaeter nochmal.',
      'Absolut!',
      'Das sieht nicht gut aus.',
      'Die Zeichen stehen guenstig.',
      'Auf keinen Fall.',
      'Vielleicht.',
    ];
    await interaction.reply({
      embeds: [
        embeds.primary(
          '🎱 Magische Kugel',
          `**Frage:** ${interaction.options.getString('question', true)}\n**Antwort:** ${answers[randomInt(0, answers.length - 1)]}`,
        ),
      ],
    });
  },
};

const gamesModule: NexusModule = {
  name: 'games',
  description: 'Minispiele mit Wirtschaftsanbindung',
  commands: [coinflip, dice, slots, rps, eightball],
};

export default gamesModule;
export { PreconditionError };
