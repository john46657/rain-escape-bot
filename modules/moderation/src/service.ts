/**
 * Zentraler Moderationsdienst.
 *
 * Jede Aktion durchlaeuft denselben Pfad (Regel 5):
 *   Vorbedingungen -> Discord-Aktion -> Fall speichern -> DM -> Mod-Log -> Audit -> Event
 *
 * Der Fall wird erst nach erfolgreicher Discord-Aktion geschrieben, damit
 * die Historie keine Aktionen enthaelt, die nie stattgefunden haben.
 */
import {
  type Guild, type GuildMember, PermissionFlagsBits, type User,
} from 'discord.js';
import {
  MODERATION_PERMISSIONS, assertBotPermission, assertModeratable, embeds, tryDirectMessage,
  wrapDiscordError, writeAudit, type Services,
} from '@nexus/bot-core';
import type { ModerationCaseEntity } from '@nexus/database';
import {
  LIMITS, PreconditionError, type ModerationAction, discordTimestamp, formatDuration,
} from '@nexus/shared';

export interface ModerationRequest {
  services: Services;
  guild: Guild;
  moderator: GuildMember;
  /** Ziel kann ein Mitglied oder (bei Ban/Unban) nur eine ID sein. */
  target: User;
  targetMember?: GuildMember | null;
  action: ModerationAction;
  reason: string;
  durationMs?: number | null;
  /** Zusaetzliche Angaben fuer den Fall (z. B. geloeschte Nachrichten). */
  metadata?: Record<string, unknown>;
  source?: ModerationCaseEntity['source'];
  /** Nutzer per DM informieren (bei automatischen Aktionen oft unerwuenscht). */
  notify?: boolean;
  /** Nachrichten der letzten N Sekunden loeschen (Ban/Softban). */
  deleteMessageSeconds?: number;
}

const ACTION_LABELS: Record<ModerationAction, string> = {
  BAN: 'Bann', UNBAN: 'Entbannung', SOFTBAN: 'Softban', KICK: 'Kick',
  TIMEOUT: 'Timeout', UNTIMEOUT: 'Timeout aufgehoben', WARN: 'Verwarnung',
  UNWARN: 'Verwarnung entfernt', CLEAR: 'Nachrichten geloescht', SLOWMODE: 'Slowmode',
  LOCK: 'Kanal gesperrt', UNLOCK: 'Kanal entsperrt', NICK: 'Nickname geaendert',
  ROLE_ADD: 'Rolle hinzugefuegt', ROLE_REMOVE: 'Rolle entfernt', NOTE: 'Notiz',
};

const ACTION_EMOJI: Record<ModerationAction, string> = {
  BAN: '🔨', UNBAN: '♻️', SOFTBAN: '🧹', KICK: '👢', TIMEOUT: '🔇', UNTIMEOUT: '🔊',
  WARN: '⚠️', UNWARN: '✅', CLEAR: '🗑️', SLOWMODE: '🐌', LOCK: '🔒', UNLOCK: '🔓',
  NICK: '🏷️', ROLE_ADD: '➕', ROLE_REMOVE: '➖', NOTE: '📝',
};

export class ModerationService {
  /**
   * Fuehrt eine Moderationsaktion vollstaendig aus.
   * Wirft bei fehlenden Rechten oder Hierarchieproblemen — der Aufrufer muss
   * die Berechtigungspruefung (`requirePermission`) bereits erledigt haben.
   */
  static async execute(request: ModerationRequest): Promise<ModerationCaseEntity> {
    const { services, guild, moderator, target, action, reason } = request;
    const botMember = guild.members.me;
    if (!botMember) throw new PreconditionError('Bot-Mitglied konnte nicht ermittelt werden');

    const targetMember =
      request.targetMember !== undefined
        ? request.targetMember
        : await guild.members.fetch(target.id).catch(() => null);

    if (['BAN', 'SOFTBAN', 'KICK', 'TIMEOUT', 'WARN', 'NICK'].includes(action)) {
      assertModeratable(guild, moderator, targetMember, botMember);
    }

    const previousState = ModerationService.snapshot(targetMember);

    // ---- Discord-Aktion ----
    try {
      await ModerationService.applyDiscordAction(request, targetMember);
    } catch (error) {
      throw wrapDiscordError(error, action);
    }

    // ---- Fall persistieren ----
    const expiresAt = request.durationMs ? new Date(Date.now() + request.durationMs) : null;
    const moderationCase = await services.store.moderation.createCase({
      guildId: guild.id,
      action,
      targetId: target.id,
      targetTag: target.tag,
      moderatorId: moderator.id,
      moderatorTag: moderator.user.tag,
      reason,
      source: request.source ?? 'COMMAND',
      previousState,
      newState: { ...ModerationService.snapshot(targetMember), ...(request.metadata ?? {}) },
      durationMs: request.durationMs ?? null,
      expiresAt,
    });

    if (action === 'WARN') {
      await services.store.moderation.addWarning({
        guildId: guild.id,
        targetId: target.id,
        moderatorId: moderator.id,
        reason,
        caseRef: moderationCase.id,
        expiresAt,
      });
    }

    // ---- Benachrichtigung an die Zielperson ----
    if (request.notify !== false && !['NOTE', 'CLEAR', 'SLOWMODE', 'LOCK', 'UNLOCK'].includes(action)) {
      await tryDirectMessage(target, {
        embeds: [
          embeds
            .warning(
              `${ACTION_EMOJI[action]} **${ACTION_LABELS[action]}**\n\n**Grund:** ${reason}` +
                (request.durationMs ? `\n**Dauer:** ${formatDuration(request.durationMs, 3)}` : ''),
              guild.name,
            )
            .setFooter({ text: `Fall ${moderationCase.caseId}` }),
        ],
      });
    }

    await ModerationService.publish(services, guild, moderationCase);
    return moderationCase;
  }

  /** Erfasst den Zustand vor der Aktion (Regel 5: vorheriger/neuer Zustand). */
  private static snapshot(member: GuildMember | null): Record<string, unknown> {
    if (!member) return { present: false };
    return {
      present: true,
      nickname: member.nickname,
      roleIds: [...member.roles.cache.keys()].filter((id) => id !== member.guild.id),
      timeoutUntil: member.communicationDisabledUntil?.toISOString() ?? null,
    };
  }

  private static async applyDiscordAction(
    request: ModerationRequest, targetMember: GuildMember | null,
  ): Promise<void> {
    const { guild, target, action, reason, moderator } = request;
    const auditReason = `${reason} — ${moderator.user.tag} (NEXUS)`;

    switch (action) {
      case 'BAN': {
        assertBotPermission(guild, MODERATION_PERMISSIONS.ban.flag, MODERATION_PERMISSIONS.ban.label);
        await guild.bans.create(target.id, {
          reason: auditReason,
          deleteMessageSeconds: request.deleteMessageSeconds ?? 0,
        });
        break;
      }
      case 'SOFTBAN': {
        assertBotPermission(guild, MODERATION_PERMISSIONS.ban.flag, MODERATION_PERMISSIONS.ban.label);
        // Softban = Ban zum Loeschen der Nachrichten, danach sofort entbannen.
        await guild.bans.create(target.id, { reason: auditReason, deleteMessageSeconds: 24 * 60 * 60 });
        await guild.bans.remove(target.id, `Softban (NEXUS) — ${moderator.user.tag}`);
        break;
      }
      case 'UNBAN': {
        assertBotPermission(guild, MODERATION_PERMISSIONS.ban.flag, MODERATION_PERMISSIONS.ban.label);
        const ban = await guild.bans.fetch(target.id).catch(() => null);
        if (!ban) throw new PreconditionError('Dieser Nutzer ist nicht gebannt');
        await guild.bans.remove(target.id, auditReason);
        break;
      }
      case 'KICK': {
        assertBotPermission(guild, MODERATION_PERMISSIONS.kick.flag, MODERATION_PERMISSIONS.kick.label);
        if (!targetMember) throw new PreconditionError('Der Nutzer ist nicht auf dem Server');
        await targetMember.kick(auditReason);
        break;
      }
      case 'TIMEOUT': {
        assertBotPermission(guild, MODERATION_PERMISSIONS.timeout.flag, MODERATION_PERMISSIONS.timeout.label);
        if (!targetMember) throw new PreconditionError('Der Nutzer ist nicht auf dem Server');
        const duration = request.durationMs ?? 0;
        if (duration <= 0 || duration > LIMITS.maxTimeoutMs) {
          throw new PreconditionError(
            `Die Timeout-Dauer muss zwischen 1 Sekunde und ${formatDuration(LIMITS.maxTimeoutMs)} liegen (Discord-Limit)`,
          );
        }
        await targetMember.timeout(duration, auditReason);
        break;
      }
      case 'UNTIMEOUT': {
        assertBotPermission(guild, MODERATION_PERMISSIONS.timeout.flag, MODERATION_PERMISSIONS.timeout.label);
        if (!targetMember) throw new PreconditionError('Der Nutzer ist nicht auf dem Server');
        await targetMember.timeout(null, auditReason);
        break;
      }
      // WARN, NOTE, UNWARN und die kanalbezogenen Aktionen benoetigen keinen
      // Discord-Aufruf — sie werden ausschliesslich in NEXUS protokolliert.
      default:
        break;
    }
  }

  /** Mod-Log-Embed, Audit-Eintrag und Realtime-Event. */
  private static async publish(services: Services, guild: Guild, entry: ModerationCaseEntity): Promise<void> {
    const config = await services.guildContext.config(guild.id);

    if (config.modLogChannelId) {
      const channel = await guild.channels.fetch(config.modLogChannelId).catch(() => null);
      if (channel?.isTextBased()) {
        const embed = embeds
          .primary(`${ACTION_EMOJI[entry.action]} ${ACTION_LABELS[entry.action]} · \`${entry.caseId}\``)
          .addFields(
            { name: 'Ziel', value: `<@${entry.targetId}>\n\`${entry.targetId}\``, inline: true },
            { name: 'Moderator', value: `<@${entry.moderatorId}>`, inline: true },
            { name: 'Zeitpunkt', value: discordTimestamp(entry.createdAt, 'f'), inline: true },
            { name: 'Grund', value: entry.reason.slice(0, 1024) },
          );
        if (entry.durationMs) {
          embed.addFields({ name: 'Dauer', value: formatDuration(entry.durationMs, 3), inline: true });
        }
        if (entry.expiresAt) {
          embed.addFields({ name: 'Laeuft ab', value: discordTimestamp(entry.expiresAt, 'R'), inline: true });
        }

        const message = await channel.send({ embeds: [embed] }).catch(() => null);
        if (message) await services.store.moderation.updateCase(entry.id, { logMessageId: message.id });
      }
    }

    await writeAudit(services, {
      guildId: guild.id,
      actorId: entry.moderatorId,
      actorType: 'discord',
      action: `moderation.${entry.action.toLowerCase()}`,
      targetId: entry.targetId,
      targetType: 'user',
      result: 'SUCCESS',
      reason: entry.reason,
      metadata: { caseId: entry.caseId, durationMs: entry.durationMs },
    });

    await services.publish('moderation.case', {
      guildId: guild.id,
      caseId: entry.caseId,
      action: entry.action,
      targetId: entry.targetId,
      moderatorId: entry.moderatorId,
      createdAt: entry.createdAt,
    });
  }

  static label(action: ModerationAction): string {
    return `${ACTION_EMOJI[action]} ${ACTION_LABELS[action]}`;
  }

  /**
   * Hebt abgelaufene, befristete Massnahmen auf (Tempban/Tempmute).
   * Wird vom Scheduler aufgerufen.
   */
  static async processExpirations(services: Services): Promise<number> {
    const expired = await services.store.moderation.listExpiredCases(new Date(), 50);
    let processed = 0;

    for (const entry of expired) {
      const guild = services.client.guilds.cache.get(entry.guildId);
      if (!guild) {
        await services.store.moderation.updateCase(entry.id, { active: false });
        continue;
      }
      try {
        if (entry.action === 'BAN') {
          const ban = await guild.bans.fetch(entry.targetId).catch(() => null);
          if (ban) {
            assertBotPermission(guild, PermissionFlagsBits.BanMembers, 'Mitglieder bannen');
            await guild.bans.remove(entry.targetId, `Temporaerer Bann abgelaufen (Fall ${entry.caseId})`);
          }
        }
        if (entry.action === 'WARN') {
          await services.store.moderation.expireWarnings(new Date());
        }
        await services.store.moderation.updateCase(entry.id, { active: false });
        processed++;
      } catch (error) {
        services.log.error('Ablauf einer Massnahme fehlgeschlagen', error, {
          guildId: entry.guildId, caseId: entry.caseId,
        });
      }
    }
    return processed;
  }
}
