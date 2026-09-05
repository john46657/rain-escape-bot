import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { embeds, type NexusModule, type SlashCommand } from '@nexus/bot-core';
import { DAY, HOUR, PreconditionError, discordTimestamp, randomInt, uuid } from '@nexus/shared';

/**
 * Modul: Wirtschaft (Regel 13).
 *
 * Alle Betraege werden serverseitig berechnet und ueber den DataStore
 * atomar gebucht. Jede Buchung erhaelt einen Idempotenzschluessel, damit
 * ein doppelter Klick oder ein Retry nie doppelt gutschreibt.
 */

const WORK_FLAVOURS = [
  'Du hast Bauteile im Spiel verkauft.',
  'Du hast einem Neuling die Steuerung erklaert.',
  'Du hast eine Runde als Server-Moderator ausgeholfen.',
  'Du hast Erz abgebaut und weiterverkauft.',
  'Du hast ein Obby getestet und Bugs gemeldet.',
];

function formatMoney(amount: number, symbol: string): string {
  return `${symbol} ${amount.toLocaleString('de-DE')}`;
}

const balance: SlashCommand = {
  category: 'economy',
  moduleToggle: 'economyEnabled',
  cooldownMs: 3_000,
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Zeigt deinen Kontostand')
    .addUserOption((option) => option.setName('user').setDescription('Anderer Nutzer')),
  execute: async ({ interaction, services, t, config }) => {
    const user = interaction.options.getUser('user') ?? interaction.user;
    const profile = await services.store.economy.getProfile(interaction.guildId!, user.id);
    const symbol = config?.currencySymbol ?? '⬢';

    await interaction.reply({
      embeds: [
        embeds
          .primary(t('economy.balanceTitle', { user: user.username }))
          .setThumbnail(user.displayAvatarURL({ size: 128 }))
          .addFields(
            { name: t('economy.wallet'), value: formatMoney(profile.wallet, symbol), inline: true },
            {
              name: t('economy.bank'),
              value: `${formatMoney(profile.bank, symbol)} / ${profile.bankCapacity}`,
              inline: true,
            },
            {
              name: t('economy.total'),
              value: formatMoney(profile.wallet + profile.bank, symbol),
              inline: true,
            },
          ),
      ],
    });
  },
};

const daily: SlashCommand = {
  category: 'economy',
  moduleToggle: 'economyEnabled',
  data: new SlashCommandBuilder().setName('daily').setDescription('Holt deine taegliche Belohnung ab'),
  execute: async ({ interaction, services, t, config }) => {
    const guildId = interaction.guildId!;
    const profile = await services.store.economy.getProfile(guildId, interaction.user.id);
    const now = Date.now();

    if (profile.lastDailyAt && now - profile.lastDailyAt.getTime() < DAY) {
      const next = new Date(profile.lastDailyAt.getTime() + DAY);
      await interaction.reply({
        embeds: [embeds.warning(t('economy.dailyCooldown', { time: discordTimestamp(next, 'R') }))],
        ephemeral: true,
      });
      return;
    }

    // Streak: nur wenn der letzte Bezug weniger als 48 Stunden her ist.
    const keepsStreak = profile.lastDailyAt !== null && now - profile.lastDailyAt.getTime() < 2 * DAY;
    const streakDays = keepsStreak ? profile.streakDays + 1 : 1;
    const base = config?.dailyAmount ?? 250;
    const bonus = Math.min(500, (streakDays - 1) * 25);
    const amount = base + bonus;

    // Der Tagesschluessel macht die Buchung idempotent.
    const dayKey = new Date().toISOString().slice(0, 10);
    await services.store.economy.mutate({
      guildId,
      userId: interaction.user.id,
      target: 'wallet',
      amount,
      type: 'DAILY',
      reason: `Tagesbelohnung (Streak ${streakDays})`,
      idempotencyKey: `daily:${guildId}:${interaction.user.id}:${dayKey}`,
    });
    await services.store.economy.touchCooldown(
      guildId,
      interaction.user.id,
      'lastDailyAt',
      new Date(),
      streakDays,
    );

    await interaction.reply({
      embeds: [
        embeds.success(
          t('economy.dailyClaimed', {
            amount: formatMoney(amount, config?.currencySymbol ?? '⬢'),
            streak: streakDays,
          }),
        ),
      ],
    });
  },
};

const work: SlashCommand = {
  category: 'economy',
  moduleToggle: 'economyEnabled',
  data: new SlashCommandBuilder().setName('work').setDescription('Arbeite fuer Muenzen'),
  execute: async ({ interaction, services, t, config }) => {
    const guildId = interaction.guildId!;
    const profile = await services.store.economy.getProfile(guildId, interaction.user.id);
    const cooldownMs = HOUR;

    if (profile.lastWorkAt && Date.now() - profile.lastWorkAt.getTime() < cooldownMs) {
      const next = new Date(profile.lastWorkAt.getTime() + cooldownMs);
      await interaction.reply({
        embeds: [embeds.warning(`Du kannst wieder arbeiten ${discordTimestamp(next, 'R')}.`)],
        ephemeral: true,
      });
      return;
    }

    const amount = randomInt(config?.workMinAmount ?? 50, config?.workMaxAmount ?? 250);
    await services.store.economy.mutate({
      guildId,
      userId: interaction.user.id,
      target: 'wallet',
      amount,
      type: 'WORK',
      reason: 'Arbeit',
      idempotencyKey: `work:${guildId}:${interaction.user.id}:${Math.floor(Date.now() / cooldownMs)}`,
    });
    await services.store.economy.touchCooldown(guildId, interaction.user.id, 'lastWorkAt', new Date());

    await interaction.reply({
      embeds: [
        embeds.success(
          t('economy.workSuccess', {
            amount: formatMoney(amount, config?.currencySymbol ?? '⬢'),
            flavour: WORK_FLAVOURS[randomInt(0, WORK_FLAVOURS.length - 1)] ?? '',
          }),
        ),
      ],
    });
  },
};

const pay: SlashCommand = {
  category: 'economy',
  moduleToggle: 'economyEnabled',
  cooldownMs: 5_000,
  data: new SlashCommandBuilder()
    .setName('pay')
    .setDescription('Ueberweist Muenzen an einen anderen Nutzer')
    .addUserOption((option) => option.setName('user').setDescription('Empfaenger').setRequired(true))
    .addIntegerOption((option) =>
      option.setName('amount').setDescription('Betrag').setRequired(true).setMinValue(1),
    ),
  execute: async ({ interaction, services, t, config }) => {
    const target = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);
    if (target.bot) throw new PreconditionError('Bots koennen keine Muenzen empfangen');

    await services.store.economy.transfer({
      guildId: interaction.guildId!,
      fromUserId: interaction.user.id,
      toUserId: target.id,
      amount,
      reason: `Transfer an ${target.tag}`,
      idempotencyKey: `pay:${uuid()}`,
    });

    await interaction.reply({
      embeds: [
        embeds.success(
          t('economy.paySuccess', {
            user: `<@${target.id}>`,
            amount: formatMoney(amount, config?.currencySymbol ?? '⬢'),
          }),
        ),
      ],
    });
  },
};

const deposit: SlashCommand = {
  category: 'economy',
  moduleToggle: 'economyEnabled',
  data: new SlashCommandBuilder()
    .setName('deposit')
    .setDescription('Zahlt Muenzen auf die Bank ein')
    .addIntegerOption((option) =>
      option.setName('amount').setDescription('Betrag').setRequired(true).setMinValue(1),
    ),
  execute: async ({ interaction, services, config }) => {
    const amount = interaction.options.getInteger('amount', true);
    const guildId = interaction.guildId!;
    const key = `deposit:${uuid()}`;
    // Zwei Buchungen, damit beide Salden korrekt protokolliert werden.
    await services.store.economy.mutate({
      guildId,
      userId: interaction.user.id,
      target: 'wallet',
      amount: -amount,
      type: 'DEPOSIT',
      reason: 'Einzahlung',
      idempotencyKey: `${key}:out`,
    });
    await services.store.economy.mutate({
      guildId,
      userId: interaction.user.id,
      target: 'bank',
      amount,
      type: 'DEPOSIT',
      reason: 'Einzahlung',
      idempotencyKey: `${key}:in`,
    });
    await interaction.reply({
      embeds: [embeds.success(`${formatMoney(amount, config?.currencySymbol ?? '⬢')} eingezahlt.`)],
    });
  },
};

const withdraw: SlashCommand = {
  category: 'economy',
  moduleToggle: 'economyEnabled',
  data: new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('Hebt Muenzen von der Bank ab')
    .addIntegerOption((option) =>
      option.setName('amount').setDescription('Betrag').setRequired(true).setMinValue(1),
    ),
  execute: async ({ interaction, services, config }) => {
    const amount = interaction.options.getInteger('amount', true);
    const guildId = interaction.guildId!;
    const key = `withdraw:${uuid()}`;
    await services.store.economy.mutate({
      guildId,
      userId: interaction.user.id,
      target: 'bank',
      amount: -amount,
      type: 'WITHDRAW',
      reason: 'Auszahlung',
      idempotencyKey: `${key}:out`,
    });
    await services.store.economy.mutate({
      guildId,
      userId: interaction.user.id,
      target: 'wallet',
      amount,
      type: 'WITHDRAW',
      reason: 'Auszahlung',
      idempotencyKey: `${key}:in`,
    });
    await interaction.reply({
      embeds: [embeds.success(`${formatMoney(amount, config?.currencySymbol ?? '⬢')} abgehoben.`)],
    });
  },
};

const shop: SlashCommand = {
  category: 'economy',
  moduleToggle: 'economyEnabled',
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Zeigt den Shop')
    .addSubcommand((sub) => sub.setName('list').setDescription('Zeigt alle Artikel'))
    .addSubcommand((sub) =>
      sub
        .setName('buy')
        .setDescription('Kauft einen Artikel')
        .addStringOption((option) =>
          option.setName('item').setDescription('Artikelschluessel').setRequired(true).setAutocomplete(true),
        )
        .addIntegerOption((option) => option.setName('amount').setDescription('Menge').setMinValue(1)),
    ),
  autocomplete: async ({ interaction, services }) => {
    const items = await services.store.economy.listItems(interaction.guildId!);
    const focused = interaction.options.getFocused().toLowerCase();
    await interaction.respond(
      items
        .filter((item) => item.key.includes(focused) || item.name.toLowerCase().includes(focused))
        .slice(0, 25)
        .map((item) => ({ name: `${item.name} — ${item.price}`, value: item.key })),
    );
  },
  execute: async ({ interaction, services, t, config }) => {
    const guildId = interaction.guildId!;
    const symbol = config?.currencySymbol ?? '⬢';

    if (interaction.options.getSubcommand() === 'list') {
      const items = await services.store.economy.listItems(guildId);
      await interaction.reply({
        embeds: [
          embeds.primary(
            `🛒 ${t('economy.shopTitle')}`,
            items
              .map(
                (item) =>
                  `${item.emoji ?? '•'} **${item.name}** — ${formatMoney(item.price, symbol)}\n` +
                  `\`${item.key}\` · ${item.description}` +
                  (item.stock >= 0 ? ` · Bestand: ${item.stock}` : ''),
              )
              .join('\n\n') || 'Der Shop ist leer.',
          ),
        ],
      });
      return;
    }

    const key = interaction.options.getString('item', true);
    const quantity = interaction.options.getInteger('amount') ?? 1;
    const item = await services.store.economy.getItem(guildId, key);
    if (!item || !item.enabled) throw new PreconditionError('Artikel nicht gefunden');
    if (item.stock >= 0 && item.stock < quantity) throw new PreconditionError('Nicht genuegend Bestand');

    const total = item.price * quantity;
    await services.store.economy.mutate({
      guildId,
      userId: interaction.user.id,
      target: 'wallet',
      amount: -total,
      type: 'SHOP_BUY',
      reason: `Kauf: ${item.name} ×${quantity}`,
      idempotencyKey: `buy:${uuid()}`,
    });
    await services.store.economy.addInventory(guildId, interaction.user.id, item.id, quantity);

    // Rollenartikel sofort zuweisen.
    if (item.kind === 'role' && item.roleId) {
      const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
      await member?.roles.add(item.roleId, `Shop-Kauf: ${item.name}`).catch(() => undefined);
    }

    await interaction.reply({
      embeds: [embeds.success(t('economy.bought', { item: item.name, price: formatMoney(total, symbol) }))],
    });
  },
};

const inventory: SlashCommand = {
  category: 'economy',
  moduleToggle: 'economyEnabled',
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('Zeigt dein Inventar')
    .addUserOption((option) => option.setName('user').setDescription('Anderer Nutzer')),
  execute: async ({ interaction, services, t }) => {
    const user = interaction.options.getUser('user') ?? interaction.user;
    const entries = await services.store.economy.inventory(interaction.guildId!, user.id);
    await interaction.reply({
      embeds: [
        embeds.primary(
          t('economy.inventoryTitle', { user: user.username }),
          entries.map((entry) => `${entry.emoji ?? '•'} **${entry.name}** ×${entry.quantity}`).join('\n') ||
            t('economy.inventoryEmpty'),
        ),
      ],
    });
  },
};

const richest: SlashCommand = {
  category: 'economy',
  moduleToggle: 'economyEnabled',
  cooldownMs: 10_000,
  data: new SlashCommandBuilder().setName('richest').setDescription('Zeigt die reichsten Mitglieder'),
  execute: async ({ interaction, services, config }) => {
    const entries = await services.store.economy.leaderboard(interaction.guildId!, 10);
    const symbol = config?.currencySymbol ?? '⬢';
    await interaction.reply({
      embeds: [
        embeds.primary(
          '💰 Vermoegensrangliste',
          entries
            .map(
              (entry) =>
                `**${entry.rank}.** <@${entry.userId}> — ${formatMoney(entry.wallet + entry.bank, symbol)}`,
            )
            .join('\n') || 'Noch keine Daten.',
        ),
      ],
    });
  },
};

const economyAdmin: SlashCommand = {
  category: 'economy',
  permission: 'discord.economy.manage',
  moduleToggle: 'economyEnabled',
  data: new SlashCommandBuilder()
    .setName('eco')
    .setDescription('Wirtschaftsverwaltung')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('give')
        .setDescription('Vergibt Muenzen')
        .addUserOption((option) => option.setName('user').setDescription('Nutzer').setRequired(true))
        .addIntegerOption((option) => option.setName('amount').setDescription('Betrag').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('additem')
        .setDescription('Legt einen Shop-Artikel an')
        .addStringOption((option) =>
          option.setName('key').setDescription('Eindeutiger Schluessel').setRequired(true),
        )
        .addStringOption((option) => option.setName('name').setDescription('Name').setRequired(true))
        .addIntegerOption((option) =>
          option.setName('price').setDescription('Preis').setRequired(true).setMinValue(0),
        )
        .addStringOption((option) => option.setName('description').setDescription('Beschreibung'))
        .addRoleOption((option) => option.setName('role').setDescription('Rolle (fuer Rollenartikel)')),
    ),
  execute: async ({ interaction, services, config }) => {
    const guildId = interaction.guildId!;
    if (interaction.options.getSubcommand() === 'give') {
      const user = interaction.options.getUser('user', true);
      const amount = interaction.options.getInteger('amount', true);
      await services.store.economy.mutate({
        guildId,
        userId: user.id,
        target: 'wallet',
        amount,
        type: 'ADMIN_ADJUST',
        reason: `Admin-Anpassung durch ${interaction.user.tag}`,
        idempotencyKey: `admin:${uuid()}`,
        allowNegative: true,
      });
      await interaction.reply({
        embeds: [
          embeds.success(`${formatMoney(amount, config?.currencySymbol ?? '⬢')} fuer <@${user.id}> gebucht.`),
        ],
      });
      return;
    }

    const role = interaction.options.getRole('role');
    const item = await services.store.economy.upsertItem({
      guildId,
      key: interaction.options.getString('key', true).toLowerCase(),
      name: interaction.options.getString('name', true),
      description: interaction.options.getString('description') ?? '—',
      emoji: null,
      price: interaction.options.getInteger('price', true),
      sellPrice: 0,
      kind: role ? 'role' : 'collectible',
      roleId: role?.id ?? null,
      payload: {},
      stock: -1,
      maxPerUser: -1,
      tradable: !role,
      enabled: true,
    });
    await interaction.reply({
      embeds: [embeds.success(`Artikel **${item.name}** angelegt (\`${item.key}\`).`)],
    });
  },
};

const economyModule: NexusModule = {
  name: 'economy',
  description: 'Waehrung, Shop und Inventar mit atomaren Transaktionen',
  commands: [balance, daily, work, pay, deposit, withdraw, shop, inventory, richest, economyAdmin],
};

export default economyModule;
