import {
  AuditLogEvent,
  type ClientEvents,
  Events,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import {
  embeds,
  requireConfirmation,
  truncate,
  writeAudit,
  type AnyEventHandler,
  type NexusModule,
  type Services,
  type SlashCommand,
} from '@nexus/bot-core';
import { DAY, discordTimestamp, formatDuration } from '@nexus/shared';
import { AntiNukeEngine, type NukeAction } from './antinuke.js';
import { AutomodEngine } from './automod.js';
import { LockdownService } from './lockdown.js';

/**
 * Modul: Sicherheit (Regeln 6-8).
 * AutoMod, Anti-Nuke, Raid-Schutz, Lockdown und Vorfallverwaltung.
 */

const security: SlashCommand = {
  category: 'security',
  cooldownMs: 3_000,
  data: new SlashCommandBuilder()
    .setName('security')
    .setDescription('Sicherheitszentrale von NEXUS')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('lockdown')
        .setDescription('Aktiviert den Notfallmodus (sperrt alle Textkanaele)')
        .addStringOption((option) => option.setName('reason').setDescription('Grund').setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName('unlock').setDescription('Hebt den Notfallmodus auf'))
    .addSubcommand((sub) =>
      sub
        .setName('incidents')
        .setDescription('Listet Sicherheitsvorfaelle')
        .addStringOption((option) =>
          option
            .setName('status')
            .setDescription('Filter')
            .addChoices(
              { name: 'Offen', value: 'OPEN' },
              { name: 'Bestaetigt', value: 'ACKNOWLEDGED' },
              { name: 'Geloest', value: 'RESOLVED' },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('resolve')
        .setDescription('Schliesst einen Vorfall ab')
        .addStringOption((option) => option.setName('id').setDescription('Incident-ID').setRequired(true)),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('whitelist')
        .setDescription('Anti-Nuke-Whitelist verwalten')
        .addSubcommand((sub) =>
          sub
            .setName('add')
            .setDescription('Fuegt Nutzer oder Rolle hinzu')
            .addMentionableOption((option) =>
              option.setName('target').setDescription('Nutzer oder Rolle').setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('remove')
            .setDescription('Entfernt Nutzer oder Rolle')
            .addMentionableOption((option) =>
              option.setName('target').setDescription('Nutzer oder Rolle').setRequired(true),
            ),
        )
        .addSubcommand((sub) => sub.setName('list').setDescription('Zeigt die Whitelist')),
    )
    .addSubcommand((sub) => sub.setName('status').setDescription('Zeigt den Sicherheitsstatus')),
  execute: async (ctx) => {
    const { interaction, services, t } = ctx;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild!;

    if (group === 'whitelist') {
      await ctx.requirePermission('discord.security.whitelist');
      const config = await services.guildContext.config(guild.id);

      if (sub === 'list') {
        const entries = config.antiNukeWhitelist.map((id) => `<@${id}> / <@&${id}> (\`${id}\`)`);
        await interaction.reply({
          embeds: [embeds.primary('Anti-Nuke-Whitelist', entries.join('\n') || t('common.none'))],
          ephemeral: true,
        });
        return;
      }

      const target = interaction.options.getMentionable('target', true);
      const targetId = 'id' in target ? target.id : '';
      const next =
        sub === 'add'
          ? [...new Set([...config.antiNukeWhitelist, targetId])]
          : config.antiNukeWhitelist.filter((id) => id !== targetId);

      await services.guildContext.updateConfig(guild.id, { antiNukeWhitelist: next });
      await writeAudit(services, {
        guildId: guild.id,
        actorId: interaction.user.id,
        actorType: 'discord',
        action: `security.whitelist.${sub}`,
        targetId,
        targetType: 'mentionable',
        result: 'SUCCESS',
        reason: null,
        metadata: { size: next.length },
      });
      await interaction.reply({
        embeds: [
          embeds.success(
            t(sub === 'add' ? 'security.whitelistAdded' : 'security.whitelistRemoved', {
              target: `<@${targetId}>`,
            }),
          ),
        ],
        ephemeral: true,
      });
      return;
    }

    switch (sub) {
      case 'lockdown': {
        await ctx.requirePermission('discord.security.lockdown');
        const reason = interaction.options.getString('reason', true);
        const confirmed = await requireConfirmation(interaction, {
          title: '🔒 Notfallmodus aktivieren',
          description:
            'Alle Textkanaele werden fuer @everyone gesperrt und der Join-Schutz aktiviert.\n' +
            `**Grund:** ${reason}`,
          confirmLabel: 'Sperren',
          cancelLabel: t('common.cancel'),
        });
        if (!confirmed) return;

        const result = await new LockdownService(services).enable(guild, interaction.user.id, reason);
        await interaction.editReply({
          embeds: [embeds.success(t('security.lockdownEnabled', { count: result.affected }))],
          components: [],
        });
        return;
      }
      case 'unlock': {
        await ctx.requirePermission('discord.security.lockdown');
        await interaction.deferReply();
        const result = await new LockdownService(services).disable(guild, interaction.user.id);
        await interaction.editReply({
          embeds: [embeds.success(t('security.lockdownDisabled', { count: result.affected }))],
        });
        return;
      }
      case 'incidents': {
        await ctx.requirePermission('discord.security.incidents');
        const status = interaction.options.getString('status') ?? undefined;
        const result = await services.store.security.listIncidents({
          guildId: guild.id,
          status: status as 'OPEN' | undefined,
          pageSize: 10,
        });
        const description =
          result.items.length === 0
            ? 'Keine Vorfaelle — sehr gut.'
            : result.items
                .map(
                  (incident) =>
                    `${incident.severity === 'CRITICAL' ? '🔴' : incident.severity === 'HIGH' ? '🟠' : '🟡'} ` +
                    `**${incident.title}** \`${incident.id.slice(0, 8)}\`\n` +
                    `${truncate(incident.description, 120)}\n` +
                    `${discordTimestamp(incident.createdAt, 'R')} · Status: ${incident.status}`,
                )
                .join('\n\n');
        await interaction.reply({
          embeds: [
            embeds
              .security('Sicherheitsvorfaelle', description)
              .setFooter({ text: `${result.total} gesamt` }),
          ],
          ephemeral: true,
        });
        return;
      }
      case 'resolve': {
        await ctx.requirePermission('discord.security.incidents');
        const id = interaction.options.getString('id', true);
        const incident = await services.store.security.getIncident(id);
        if (!incident || incident.guildId !== guild.id) {
          await interaction.reply({
            embeds: [embeds.warning(t('common.notFound', { resource: 'Vorfall' }))],
            ephemeral: true,
          });
          return;
        }
        await services.store.security.updateIncident(id, {
          status: 'RESOLVED',
          resolvedBy: interaction.user.id,
        });
        await writeAudit(services, {
          guildId: guild.id,
          actorId: interaction.user.id,
          actorType: 'discord',
          action: 'security.incident.resolve',
          targetId: id,
          targetType: 'incident',
          result: 'SUCCESS',
          reason: null,
          metadata: {},
        });
        await interaction.reply({
          embeds: [embeds.success(`Vorfall \`${id.slice(0, 8)}\` geschlossen.`)],
          ephemeral: true,
        });
        return;
      }
      default: {
        await ctx.requirePermission('discord.security.view');
        const config = await services.guildContext.config(guild.id);
        const open = await services.store.security.listIncidents({
          guildId: guild.id,
          status: 'OPEN',
          pageSize: 1,
        });
        const rules = Object.entries(config.automodConfig).filter(([, rule]) => rule?.enabled);

        await interaction.reply({
          embeds: [
            embeds.security('Sicherheitsstatus', `Server: **${guild.name}**`).addFields(
              {
                name: 'AutoMod',
                value: config.automodEnabled ? `🟢 aktiv (${rules.length} Regeln)` : '🔴 aus',
                inline: true,
              },
              { name: 'Anti-Nuke', value: config.antiNukeEnabled ? '🟢 aktiv' : '🔴 aus', inline: true },
              { name: 'Join-Schutz', value: config.raidModeEnabled ? '🟢 aktiv' : '⚪ aus', inline: true },
              {
                name: 'Notfallmodus',
                value: config.lockdownActive
                  ? `🔒 aktiv seit ${config.lockdownAt ? discordTimestamp(config.lockdownAt, 'R') : '—'}`
                  : '🔓 inaktiv',
                inline: true,
              },
              { name: 'Offene Vorfaelle', value: String(open.total), inline: true },
              {
                name: 'Mindest-Kontoalter',
                value: config.minAccountAgeDays > 0 ? `${config.minAccountAgeDays} Tage` : 'keins',
                inline: true,
              },
              {
                name: 'Aktive AutoMod-Regeln',
                value: rules.map(([name, rule]) => `\`${name}\` → ${rule?.action}`).join('\n') || 'keine',
              },
            ),
          ],
          ephemeral: true,
        });
      }
    }
  },
};

// -------------------------------------------------------------- Events
const automodEvent: AnyEventHandler = {
  event: Events.MessageCreate,
  execute: async (services, message) => {
    if (!message.inGuild() || message.author.bot) return;
    const config = await services.guildContext.config(message.guildId);
    if (!config.automodEnabled) return;

    const engine = new AutomodEngine(services);
    const violation = await engine.inspect(message, config);
    if (!violation) return;

    await engine.enforce(message, violation, async (action, reason, durationMs) => {
      // Import zur Laufzeit, um eine Zirkelabhaengigkeit der Module zu vermeiden.
      const { ModerationService } = await import('@nexus/module-moderation');
      const me = message.guild.members.me;
      if (!me) return;
      await ModerationService.execute({
        services,
        guild: message.guild,
        moderator: me,
        target: message.author,
        targetMember: message.member,
        action,
        reason,
        durationMs: durationMs ?? null,
        source: 'AUTOMOD',
      });
    });
  },
};

/** Join-Schutz: Raid-Erkennung und Mindest-Kontoalter. */
const joinGuard: AnyEventHandler = {
  event: Events.GuildMemberAdd,
  execute: async (services, member) => {
    const config = await services.guildContext.config(member.guild.id);

    const joinsPerMinute = await services.cache.slidingWindow(
      'raid:joins',
      member.guild.id,
      member.id,
      60_000,
    );
    const raidRule = config.automodConfig.RAID_DETECTION;

    if (raidRule?.enabled && joinsPerMinute > raidRule.threshold) {
      const isNew = await services.cache.markOnce('raid:incident', member.guild.id, 10 * 60_000);
      if (isNew) {
        await services.store.security.createIncident({
          guildId: member.guild.id,
          kind: 'RAID',
          severity: 'HIGH',
          status: 'OPEN',
          title: 'Moeglicher Raid erkannt',
          description: `${joinsPerMinute} Beitritte in 60 Sekunden (Grenzwert: ${raidRule.threshold}).`,
          actorId: null,
          actorType: null,
          robloxGameId: null,
          evidence: { joinsPerMinute, threshold: raidRule.threshold },
          actionsTaken: config.raidModeEnabled ? ['Join-Schutz war bereits aktiv'] : [],
        });
        services.log.security('Raid erkannt', { guildId: member.guild.id, joinsPerMinute });
        await services.publish('security.raid', { guildId: member.guild.id, joinsPerMinute });
      }
    }

    if (config.minAccountAgeDays > 0) {
      const ageDays = (Date.now() - member.user.createdTimestamp) / DAY;
      if (ageDays < config.minAccountAgeDays && member.kickable) {
        await member
          .send({
            embeds: [
              embeds.warning(
                `Dein Discord-Konto muss mindestens **${config.minAccountAgeDays} Tage** alt sein, ` +
                  `um **${member.guild.name}** beizutreten. Aktuelles Alter: ${formatDuration(Date.now() - member.user.createdTimestamp, 2)}.`,
              ),
            ],
          })
          .catch(() => undefined);
        await member
          .kick(`NEXUS Join-Schutz: Konto juenger als ${config.minAccountAgeDays} Tage`)
          .catch(() => undefined);
        services.log.security('Beitritt abgelehnt (Kontoalter)', {
          guildId: member.guild.id,
          userId: member.id,
          ageDays: Math.round(ageDays),
        });
      }
    }
  },
};

/**
 * Verknuepft Discord-Gateway-Events mit der Anti-Nuke-Erkennung.
 *
 * Die Gateway-Nutzlast unterscheidet sich je Event, enthaelt aber immer
 * entweder eine Guild-Referenz oder eine ID. Daher wird hier bewusst auf
 * eine schmale Struktur reduziert und der Verursacher ueber das Audit-Log
 * ermittelt.
 */
interface NukeResource {
  id?: string;
  guild?: { id: string } | null;
}

function nukeEvent(event: keyof ClientEvents, auditType: AuditLogEvent, action: NukeAction): AnyEventHandler {
  const handler = {
    event,
    execute: async (services: Services, ...args: unknown[]): Promise<void> => {
      const resource = args[0] as NukeResource | undefined;
      const guildId = resource?.guild?.id;
      if (!guildId) return;
      const guild = services.client.guilds.cache.get(guildId);
      if (!guild) return;

      const engine = new AntiNukeEngine(services);
      const entry = await engine.resolveExecutor(guild, auditType, resource?.id);
      if (!entry?.executorId) return;

      await engine.track(guild, entry.executorId, action, {
        targetId: resource?.id ?? null,
        auditLogId: entry.id,
      });
    },
  };
  return handler as unknown as AnyEventHandler;
}

const securityModule: NexusModule = {
  name: 'security',
  description: 'AutoMod, Anti-Nuke, Raid-Schutz und Notfallmodus',
  commands: [security],
  events: [
    automodEvent,
    joinGuard,
    nukeEvent(Events.ChannelDelete, AuditLogEvent.ChannelDelete, 'CHANNEL_DELETE'),
    nukeEvent(Events.GuildRoleDelete, AuditLogEvent.RoleDelete, 'ROLE_DELETE'),
    nukeEvent(Events.GuildBanAdd, AuditLogEvent.MemberBanAdd, 'BAN'),
    nukeEvent(Events.GuildMemberRemove, AuditLogEvent.MemberKick, 'KICK'),
    nukeEvent(Events.WebhooksUpdate, AuditLogEvent.WebhookCreate, 'WEBHOOK_CREATE'),
  ],
  jobs: [
    {
      name: 'security:incident-digest',
      intervalMs: 15 * 60_000,
      singleton: true,
      execute: async (services) => {
        // Offene kritische Vorfaelle aelter als eine Stunde erneut melden.
        const open = await services.store.security.listIncidents({
          status: 'OPEN',
          severity: 'CRITICAL',
          pageSize: 20,
        });
        for (const incident of open.items) {
          if (!incident.guildId || Date.now() - incident.createdAt.getTime() < 60 * 60_000) continue;
          await services.store.notifications.create({
            guildId: incident.guildId,
            userId: null,
            category: 'security',
            severity: 'CRITICAL',
            title: `Unbearbeiteter Vorfall: ${incident.title}`,
            body: incident.description,
            link: `/dashboard/${incident.guildId}/security`,
          });
        }
      },
    },
  ],
};

export default securityModule;
export { AntiNukeEngine } from './antinuke.js';
export { AutomodEngine } from './automod.js';
export { LockdownService } from './lockdown.js';
