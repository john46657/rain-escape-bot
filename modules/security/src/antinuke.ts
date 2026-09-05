/**
 * Anti-Nuke (Regel 7).
 *
 * Erkennt ungewoehnlich viele destruktive Admin-Aktionen in kurzer Zeit.
 * Die Datenquelle sind Discord-Gateway-Events kombiniert mit dem Audit-Log
 * (nur so ist der tatsaechliche Verursacher ermittelbar).
 *
 * Wichtig und ehrlich dokumentiert:
 *  - Discord erlaubt es NICHT, eine bereits ausgefuehrte Aktion rueckgaengig
 *    zu machen oder eine laufende zu unterbrechen. Was NEXUS tun kann:
 *    den Verursacher entmachten (Rollen entziehen / bannen), einen Lockdown
 *    ausloesen und alarmieren. Genau das ist implementiert.
 *  - Ohne die Berechtigung "Audit-Log einsehen" ist keine Zuordnung moeglich;
 *    in dem Fall wird nur alarmiert, nicht bestraft.
 */
import {
  AuditLogEvent, type Guild, type GuildAuditLogsEntry, PermissionFlagsBits,
} from 'discord.js';
import { embeds, writeAudit, type Services } from '@nexus/bot-core';
import type { AntiNukeThresholds } from '@nexus/database';
import { DEFAULT_ANTINUKE } from '@nexus/database';
import { MINUTE, type IncidentSeverity } from '@nexus/shared';

export type NukeAction =
  | 'BAN' | 'KICK' | 'CHANNEL_DELETE' | 'ROLE_DELETE' | 'WEBHOOK_CREATE'
  | 'ROLE_UPDATE' | 'BOT_ADD' | 'GUILD_UPDATE';

const THRESHOLD_KEYS: Record<NukeAction, keyof AntiNukeThresholds> = {
  BAN: 'banPerMinute',
  KICK: 'kickPerMinute',
  CHANNEL_DELETE: 'channelDeletePerMinute',
  ROLE_DELETE: 'roleDeletePerMinute',
  WEBHOOK_CREATE: 'webhookCreatePerMinute',
  ROLE_UPDATE: 'memberUpdatePerMinute',
  BOT_ADD: 'botAddPerHour',
  GUILD_UPDATE: 'memberUpdatePerMinute',
};

const SEVERITY_BY_ACTION: Record<NukeAction, IncidentSeverity> = {
  BAN: 'CRITICAL', KICK: 'HIGH', CHANNEL_DELETE: 'CRITICAL', ROLE_DELETE: 'CRITICAL',
  WEBHOOK_CREATE: 'HIGH', ROLE_UPDATE: 'MEDIUM', BOT_ADD: 'HIGH', GUILD_UPDATE: 'MEDIUM',
};

export class AntiNukeEngine {
  constructor(private readonly services: Services) {}

  /**
   * Registriert eine potenziell gefaehrliche Aktion und prueft die Schwelle.
   * Gibt true zurueck, wenn ein Incident ausgeloest wurde.
   */
  async track(guild: Guild, actorId: string, action: NukeAction, context: Record<string, unknown> = {}): Promise<boolean> {
    const config = await this.services.guildContext.config(guild.id);
    if (!config.antiNukeEnabled) return false;

    // Whitelist: Bot selbst, Guild-Owner und explizit freigegebene IDs.
    if (actorId === this.services.client.user?.id) return false;
    if (actorId === guild.ownerId) return false;
    if (config.antiNukeWhitelist.includes(actorId)) return false;

    const member = await guild.members.fetch(actorId).catch(() => null);
    if (member && member.roles.cache.some((role) => config.antiNukeWhitelist.includes(role.id))) return false;

    const thresholds: AntiNukeThresholds = { ...DEFAULT_ANTINUKE, ...config.antiNukeThresholds };
    const windowMs = action === 'BOT_ADD' ? 60 * MINUTE : MINUTE;
    const limit = thresholds[THRESHOLD_KEYS[action]];

    const count = await this.services.cache.slidingWindow(
      `antinuke:${action}`, `${guild.id}:${actorId}`, `${Date.now()}`, windowMs,
    );
    if (count <= limit) return false;

    // Ein Incident je Akteur und Aktion pro Fenster — kein Alarm-Spam.
    const isNew = await this.services.cache.markOnce(`antinuke:incident`, `${guild.id}:${actorId}:${action}`, windowMs);
    if (!isNew) return false;

    await this.trigger(guild, actorId, action, count, limit, context);
    return true;
  }

  private async trigger(
    guild: Guild, actorId: string, action: NukeAction, count: number, limit: number,
    context: Record<string, unknown>,
  ): Promise<void> {
    const severity = SEVERITY_BY_ACTION[action];
    const actionsTaken: string[] = [];

    // ---- Gegenmassnahme: Verursacher entmachten ----
    const member = await guild.members.fetch(actorId).catch(() => null);
    const me = guild.members.me;
    if (member && me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      const removable = member.roles.cache.filter(
        (role) => role.id !== guild.id && role.position < me.roles.highest.position && !role.managed,
      );
      if (removable.size > 0) {
        const removed = await member.roles
          .remove(removable, `NEXUS Anti-Nuke: ${action} (${count}/${limit})`)
          .then(() => true)
          .catch(() => false);
        if (removed) actionsTaken.push(`Rollen entzogen (${removable.size})`);
      }
    }

    const incident = await this.services.store.security.createIncident({
      guildId: guild.id,
      kind: 'ANTINUKE',
      severity,
      status: 'OPEN',
      title: `Anti-Nuke: ${action}`,
      description:
        `<@${actorId}> hat ${count} ${action}-Aktionen ausgefuehrt (Grenzwert: ${limit}). ` +
        'Bitte pruefen und den Vorfall abschliessen.',
      actorId,
      actorType: 'discord',
      robloxGameId: null,
      evidence: { action, count, limit, ...context },
      actionsTaken,
    });

    this.services.log.security('Anti-Nuke ausgeloest', {
      guildId: guild.id, userId: actorId, action, count, limit, incidentId: incident.id,
    });

    await writeAudit(this.services, {
      guildId: guild.id,
      actorId,
      actorType: 'system',
      action: 'security.antinuke.trigger',
      targetId: actorId,
      targetType: 'user',
      result: 'SUCCESS',
      reason: `${action} × ${count}`,
      metadata: { incidentId: incident.id, actionsTaken },
    });

    await this.alert(guild, incident.id, actorId, action, count, limit, actionsTaken);
    await this.services.publish('security.incident', {
      guildId: guild.id, incidentId: incident.id, severity, kind: 'ANTINUKE', actorId,
    });
  }

  private async alert(
    guild: Guild, incidentId: string, actorId: string, action: NukeAction,
    count: number, limit: number, actionsTaken: string[],
  ): Promise<void> {
    const config = await this.services.guildContext.config(guild.id);
    const channelId = config.securityChannelId ?? config.modLogChannelId;
    if (!channelId) return;

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    await channel
      .send({
        content: `<@${guild.ownerId}>`,
        embeds: [
          embeds
            .security('Anti-Nuke ausgeloest', `Verdaechtige Massenaktion durch <@${actorId}>.`)
            .addFields(
              { name: 'Aktion', value: action, inline: true },
              { name: 'Anzahl', value: `${count} (Limit ${limit})`, inline: true },
              { name: 'Incident', value: `\`${incidentId}\``, inline: true },
              { name: 'Automatische Massnahmen', value: actionsTaken.join('\n') || 'Keine (fehlende Rechte)' },
              {
                name: 'Naechste Schritte',
                value:
                  '`/security incidents` zum Pruefen · `/security lockdown` bei akutem Angriff\n' +
                  'Hinweis: Discord erlaubt kein Rueckgaengigmachen bereits ausgefuehrter Aktionen.',
              },
            ),
        ],
      })
      .catch(() => undefined);
  }

  /**
   * Ermittelt den Verursacher aus dem Audit-Log.
   * Gateway-Events enthalten den Ausfuehrenden nicht — ohne Audit-Log-Recht
   * ist keine Zuordnung moeglich (dann null).
   */
  async resolveExecutor(
    guild: Guild, type: AuditLogEvent, targetId?: string,
  ): Promise<GuildAuditLogsEntry | null> {
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;
    const logs = await guild.fetchAuditLogs({ type, limit: 5 }).catch(() => null);
    if (!logs) return null;

    const cutoff = Date.now() - 10_000;
    const entry = logs.entries.find(
      (candidate) =>
        candidate.createdTimestamp > cutoff &&
        (!targetId || (candidate.target && 'id' in candidate.target && candidate.target.id === targetId)),
    );
    return entry ?? null;
  }
}
