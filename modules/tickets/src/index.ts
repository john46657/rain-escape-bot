import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type GuildTextBasedChannel,
} from 'discord.js';
import {
  customId,
  embeds,
  truncate,
  writeAudit,
  type NexusModule,
  type Services,
  type SlashCommand,
} from '@nexus/bot-core';
import type { TicketEntity } from '@nexus/database';
import { PreconditionError, TICKET_CATEGORIES, discordTimestamp, type TicketCategory } from '@nexus/shared';

/**
 * Modul: Tickets (Regel 9).
 * Panel mit Auswahlmenue, Modal-Formular, Claim/Close/Reopen und Transkript.
 */

const CATEGORY_LABELS: Record<TicketCategory, { label: string; emoji: string }> = {
  SUPPORT: { label: 'Allgemeiner Support', emoji: '💬' },
  REPORT: { label: 'Nutzer melden', emoji: '🚩' },
  APPLICATION: { label: 'Bewerbung', emoji: '📝' },
  COMPLAINT: { label: 'Beschwerde', emoji: '⚖️' },
  UNBAN: { label: 'Entbannungsantrag', emoji: '🔓' },
  PARTNERSHIP: { label: 'Partnerschaft', emoji: '🤝' },
  OTHER: { label: 'Sonstiges', emoji: '📦' },
};

const MAX_OPEN_TICKETS = 3;

async function buildTicketChannel(
  services: Services,
  guildId: string,
  openerId: string,
  category: TicketCategory,
  subject: string | null,
): Promise<{ ticket: TicketEntity; channel: GuildTextBasedChannel }> {
  const guild = services.client.guilds.cache.get(guildId);
  if (!guild) throw new PreconditionError('Server nicht verfuegbar');

  const open = await services.store.tickets.countOpenByUser(guildId, openerId);
  if (open >= MAX_OPEN_TICKETS) {
    throw new PreconditionError(`Du hast bereits ${open} offene Tickets`, { count: open });
  }

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    throw new PreconditionError('Mir fehlt die Berechtigung "Kanaele verwalten"');
  }

  // Kanal zuerst anlegen, dann Ticket speichern: so gibt es keine
  // Ticketeintraege ohne zugehoerigen Kanal.
  const channel = await guild.channels.create({
    name: `ticket-${openerId.slice(-4)}-${Date.now().toString(36).slice(-4)}`,
    type: ChannelType.GuildText,
    topic: `${CATEGORY_LABELS[category].label} · <@${openerId}>`,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: openerId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
        ],
      },
      {
        id: me.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
        ],
      },
    ],
    reason: `NEXUS Ticket fuer ${openerId}`,
  });

  const ticket = await services.store.tickets.create({
    guildId,
    channelId: channel.id,
    openerId,
    category,
    subject,
  });
  await channel.setName(`ticket-${String(ticket.number).padStart(4, '0')}`).catch(() => undefined);

  await channel.send({
    content: `<@${openerId}>`,
    embeds: [
      embeds
        .primary(
          `🎫 Ticket #${String(ticket.number).padStart(4, '0')}`,
          subject ?? 'Ein Teammitglied meldet sich in Kuerze.',
        )
        .addFields(
          {
            name: 'Kategorie',
            value: `${CATEGORY_LABELS[category].emoji} ${CATEGORY_LABELS[category].label}`,
            inline: true,
          },
          { name: 'Erstellt', value: discordTimestamp(ticket.createdAt, 'R'), inline: true },
        ),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(customId('ticket', 'claim', ticket.id))
          .setLabel('Uebernehmen')
          .setEmoji('🙋')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(customId('ticket', 'close', ticket.id))
          .setLabel('Schliessen')
          .setEmoji('🔒')
          .setStyle(ButtonStyle.Danger),
      ),
    ],
  });

  await services.publish('ticket.created', { guildId, ticketId: ticket.id, number: ticket.number, openerId });
  return { ticket, channel };
}

/** Erzeugt ein Text-Transkript aus den gespeicherten Nachrichten. */
async function buildTranscript(services: Services, ticket: TicketEntity): Promise<Buffer> {
  const messages = await services.store.tickets.listMessages(ticket.id);
  const header =
    `NEXUS Ticket-Transkript\n` +
    `Ticket: #${String(ticket.number).padStart(4, '0')}\n` +
    `Kategorie: ${ticket.category}\n` +
    `Eroeffnet von: ${ticket.openerId}\n` +
    `Erstellt: ${ticket.createdAt.toISOString()}\n` +
    `${'='.repeat(60)}\n\n`;
  const body = messages
    .map(
      (message) =>
        `[${message.createdAt.toISOString()}] ${message.authorTag}${message.isStaff ? ' (Team)' : ''}: ${message.content}`,
    )
    .join('\n');
  return Buffer.from(header + (body || '(keine Nachrichten aufgezeichnet)'), 'utf8');
}

async function closeTicket(
  services: Services,
  ticket: TicketEntity,
  closedById: string,
  reason: string,
): Promise<void> {
  const guild = services.client.guilds.cache.get(ticket.guildId);
  const channel = guild ? await guild.channels.fetch(ticket.channelId).catch(() => null) : null;

  // Nachrichten fuer das Transkript sichern, bevor der Kanal verschwindet.
  if (channel?.isTextBased()) {
    const fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    for (const message of [...(fetched?.values() ?? [])].reverse()) {
      await services.store.tickets.addMessage({
        ticketId: ticket.id,
        messageId: message.id,
        authorId: message.author.id,
        authorTag: message.author.tag,
        content: message.content || '(Anhang/Embed)',
        attachments: [...message.attachments.values()].map((attachment) => ({
          name: attachment.name,
          url: attachment.url,
        })),
        isStaff: message.member?.permissions.has(PermissionFlagsBits.ManageMessages) ?? false,
      });
    }
  }

  const updated = await services.store.tickets.update(ticket.id, {
    status: 'CLOSED',
    closedById,
    closedAt: new Date(),
    closeReason: reason,
  });

  const transcript = await buildTranscript(services, updated);
  const config = await services.guildContext.config(ticket.guildId);
  const logChannelId = config.auditLogChannelId ?? config.modLogChannelId;
  if (logChannelId && guild) {
    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
    if (logChannel?.isTextBased()) {
      await logChannel
        .send({
          embeds: [
            embeds
              .info(`Ticket #${String(ticket.number).padStart(4, '0')} geschlossen`, '🎫 Ticket')
              .addFields(
                { name: 'Eroeffnet von', value: `<@${ticket.openerId}>`, inline: true },
                { name: 'Geschlossen von', value: `<@${closedById}>`, inline: true },
                { name: 'Grund', value: truncate(reason, 1024) },
              ),
          ],
          files: [{ attachment: transcript, name: `ticket-${ticket.number}.txt` }],
        })
        .catch(() => undefined);
    }
  }

  await writeAudit(services, {
    guildId: ticket.guildId,
    actorId: closedById,
    actorType: 'discord',
    action: 'ticket.close',
    targetId: ticket.id,
    targetType: 'ticket',
    result: 'SUCCESS',
    reason,
    metadata: { number: ticket.number },
  });

  if (channel && 'delete' in channel) {
    setTimeout(
      () => void channel.delete(`Ticket geschlossen von ${closedById}`).catch(() => undefined),
      5_000,
    );
  }
  await services.publish('ticket.closed', { guildId: ticket.guildId, ticketId: ticket.id, closedById });
}

const ticketCommand: SlashCommand = {
  category: 'tickets',
  moduleToggle: 'ticketsEnabled',
  cooldownMs: 5_000,
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Ticketsystem')
    .addSubcommand((sub) =>
      sub
        .setName('open')
        .setDescription('Eroeffnet ein Ticket')
        .addStringOption((option) =>
          option
            .setName('category')
            .setDescription('Kategorie')
            .setRequired(true)
            .addChoices(...TICKET_CATEGORIES.map((value) => ({ name: CATEGORY_LABELS[value].label, value }))),
        )
        .addStringOption((option) =>
          option.setName('subject').setDescription('Kurzbeschreibung').setMaxLength(200),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('close')
        .setDescription('Schliesst das aktuelle Ticket')
        .addStringOption((option) => option.setName('reason').setDescription('Grund')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Fuegt einen Nutzer zum Ticket hinzu')
        .addUserOption((option) => option.setName('user').setDescription('Nutzer').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub.setName('panel').setDescription('Erstellt ein Ticket-Panel im aktuellen Kanal'),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Zeigt offene Tickets')),
  execute: async (ctx) => {
    const { interaction, services, t } = ctx;
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId!;

    switch (sub) {
      case 'open': {
        await interaction.deferReply({ ephemeral: true });
        const category = interaction.options.getString('category', true) as TicketCategory;
        const subject = interaction.options.getString('subject');
        const { channel } = await buildTicketChannel(
          services,
          guildId,
          interaction.user.id,
          category,
          subject,
        );
        await interaction.editReply({
          embeds: [embeds.success(t('tickets.created', { channel: `<#${channel.id}>` }))],
        });
        return;
      }
      case 'close': {
        const ticket = await services.store.tickets.findByChannel(interaction.channelId);
        if (!ticket) throw new PreconditionError('Dieser Kanal ist kein Ticket');
        const isOwner = ticket.openerId === interaction.user.id;
        if (!isOwner) await ctx.requirePermission('discord.tickets.close');

        await interaction.reply({
          embeds: [embeds.info('Ticket wird geschlossen — Transkript wird erstellt…')],
        });
        await closeTicket(
          services,
          ticket,
          interaction.user.id,
          interaction.options.getString('reason') ?? 'Kein Grund angegeben',
        );
        return;
      }
      case 'add': {
        await ctx.requirePermission('discord.tickets.manage');
        const ticket = await services.store.tickets.findByChannel(interaction.channelId);
        if (!ticket) throw new PreconditionError('Dieser Kanal ist kein Ticket');
        const user = interaction.options.getUser('user', true);
        const channel = await interaction.guild!.channels.fetch(ticket.channelId);
        if (channel && 'permissionOverwrites' in channel) {
          await channel.permissionOverwrites.edit(user.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
          });
        }
        await interaction.reply({ embeds: [embeds.success(`<@${user.id}> wurde hinzugefuegt.`)] });
        return;
      }
      case 'panel': {
        await ctx.requirePermission('discord.tickets.manage');
        const select = new StringSelectMenuBuilder()
          .setCustomId(customId('ticket', 'panel'))
          .setPlaceholder('Kategorie waehlen…')
          .addOptions(
            TICKET_CATEGORIES.map((value) => ({
              label: CATEGORY_LABELS[value].label,
              value,
              emoji: CATEGORY_LABELS[value].emoji,
            })),
          );
        if (interaction.channel?.isTextBased()) {
          await (interaction.channel as GuildTextBasedChannel).send({
            embeds: [embeds.primary(t('tickets.panelTitle'), t('tickets.panelDescription'))],
            components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
          });
        }
        await interaction.reply({ embeds: [embeds.success('Panel erstellt.')], ephemeral: true });
        return;
      }
      default: {
        await ctx.requirePermission('discord.tickets.view');
        const result = await services.store.tickets.list(guildId, { status: 'OPEN', pageSize: 15 });
        await interaction.reply({
          embeds: [
            embeds.primary(
              'Offene Tickets',
              result.items
                .map(
                  (ticket) =>
                    `**#${String(ticket.number).padStart(4, '0')}** <#${ticket.channelId}> · <@${ticket.openerId}> · ` +
                    `${CATEGORY_LABELS[ticket.category].emoji} ${discordTimestamp(ticket.createdAt, 'R')}`,
                )
                .join('\n') || 'Keine offenen Tickets.',
            ),
          ],
          ephemeral: true,
        });
      }
    }
  },
};

const ticketsModule: NexusModule = {
  name: 'tickets',
  description: 'Ticketsystem mit Panel, Claim und Transkripten',
  commands: [ticketCommand],
  components: [
    {
      id: 'ticket',
      kind: 'select',
      cooldownMs: 10_000,
      execute: async ({ interaction, services, t }) => {
        if (!interaction.isStringSelectMenu() || !interaction.guildId) return;
        const category = interaction.values[0] as TicketCategory;
        const modal = new ModalBuilder()
          .setCustomId(customId('ticket', 'modal', category))
          .setTitle(`Ticket: ${CATEGORY_LABELS[category].label}`.slice(0, 45))
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('subject')
                .setLabel('Worum geht es?')
                .setStyle(TextInputStyle.Short)
                .setMaxLength(100)
                .setRequired(true),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('details')
                .setLabel('Details')
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(1000)
                .setRequired(false),
            ),
          );
        await interaction.showModal(modal);
        void t;
        void services;
      },
    },
    {
      id: 'ticket',
      kind: 'modal',
      execute: async ({ interaction, services, t, args }) => {
        if (!interaction.isModalSubmit() || !interaction.guildId) return;
        const category = (args[1] ?? 'SUPPORT') as TicketCategory;
        const subject = interaction.fields.getTextInputValue('subject');
        const details = interaction.fields.getTextInputValue('details');

        await interaction.deferReply({ ephemeral: true });
        const { ticket, channel } = await buildTicketChannel(
          services,
          interaction.guildId,
          interaction.user.id,
          category,
          subject,
        );
        if (details) {
          await channel
            .send({ embeds: [embeds.info(truncate(details, 4000), 'Beschreibung')] })
            .catch(() => undefined);
          await services.store.tickets.addMessage({
            ticketId: ticket.id,
            messageId: interaction.id,
            authorId: interaction.user.id,
            authorTag: interaction.user.tag,
            content: details,
            attachments: [],
            isStaff: false,
          });
        }
        await interaction.editReply({
          embeds: [embeds.success(t('tickets.created', { channel: `<#${channel.id}>` }))],
        });
      },
    },
    {
      id: 'ticket',
      kind: 'button',
      execute: async ({ interaction, services, t, args, requirePermission }) => {
        if (!interaction.isButton()) return;
        const [action, ticketId] = args;
        const ticket = await services.store.tickets.findByChannel(interaction.channelId);
        if (!ticket || ticket.id !== ticketId) {
          await interaction.reply({ embeds: [embeds.warning('Ticket nicht gefunden.')], ephemeral: true });
          return;
        }

        if (action === 'claim') {
          await requirePermission('discord.tickets.claim');
          await services.store.tickets.update(ticket.id, {
            status: 'CLAIMED',
            claimedById: interaction.user.id,
          });
          await interaction.reply({
            embeds: [embeds.success(t('tickets.claimed', { user: `<@${interaction.user.id}>` }))],
          });
          return;
        }

        if (action === 'close') {
          const isOwner = ticket.openerId === interaction.user.id;
          if (!isOwner) await requirePermission('discord.tickets.close');
          await interaction.reply({
            embeds: [embeds.info('Ticket wird geschlossen — Transkript wird erstellt…')],
          });
          await closeTicket(services, ticket, interaction.user.id, 'Ueber Button geschlossen');
        }
      },
    },
  ],
};

export default ticketsModule;
