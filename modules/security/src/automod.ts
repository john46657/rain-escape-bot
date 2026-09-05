/**
 * AutoMod-Engine (Regel 6).
 *
 * Grundsaetze:
 *  - Alle Regeln sind pro Guild konfigurierbar (Aktion, Schwellenwert, Ausnahmen).
 *  - Auswertung erfolgt lokal (keine externen Aufrufe) — sonst waere jede
 *    Nachricht eine Netzwerkanfrage.
 *  - Zaehlbasierte Regeln nutzen Redis-Sliding-Windows und funktionieren
 *    dadurch auch ueber mehrere Shards hinweg.
 *  - Es wird immer nur die schwerste erkannte Verletzung geahndet.
 */
import { type GuildMember, type Message, PermissionFlagsBits } from 'discord.js';
import type { Services } from '@nexus/bot-core';
import type { AutomodRuleConfig, GuildConfigEntity } from '@nexus/database';
import {
  INVITE_PATTERN,
  capsRatio,
  extractHosts,
  isPhishingHost,
  normalizeForFilter,
  scamScore,
} from '@nexus/security';
import type { AutomodAction, AutomodRule } from '@nexus/shared';

export interface AutomodViolation {
  rule: AutomodRule;
  action: AutomodAction;
  reason: string;
  /** 0..1 — wie sicher die Erkennung ist. */
  confidence: number;
  timeoutMs?: number;
}

const SEVERITY: Record<AutomodAction, number> = {
  LOG_ONLY: 0,
  DELETE: 1,
  WARN: 2,
  TIMEOUT: 3,
  KICK: 4,
  BAN: 5,
};

export class AutomodEngine {
  constructor(private readonly services: Services) {}

  /** Prueft eine Nachricht und liefert die schwerste Verletzung (oder null). */
  async inspect(message: Message, config: GuildConfigEntity): Promise<AutomodViolation | null> {
    if (!config.automodEnabled || !message.inGuild() || message.author.bot) return null;

    const member = message.member;
    if (!member) return null;
    // Moderatoren sind grundsaetzlich ausgenommen.
    if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return null;

    const violations: AutomodViolation[] = [];
    const rules = config.automodConfig;

    for (const [name, rule] of Object.entries(rules) as Array<[AutomodRule, AutomodRuleConfig | undefined]>) {
      if (!rule?.enabled) continue;
      if (rule.exemptChannelIds.includes(message.channelId)) continue;
      if (rule.exemptRoleIds.some((roleId) => member.roles.cache.has(roleId))) continue;

      const violation = await this.evaluate(name, rule, message, member);
      if (violation) violations.push(violation);
    }

    if (violations.length === 0) return null;
    return violations.sort(
      (a, b) => SEVERITY[b.action] - SEVERITY[a.action] || b.confidence - a.confidence,
    )[0]!;
  }

  private async evaluate(
    rule: AutomodRule,
    config: AutomodRuleConfig,
    message: Message,
    member: GuildMember,
  ): Promise<AutomodViolation | null> {
    const content = message.content ?? '';
    const build = (reason: string, confidence: number): AutomodViolation => ({
      rule,
      action: config.action,
      reason,
      confidence,
      timeoutMs: config.timeoutMs,
    });

    switch (rule) {
      case 'ANTI_SPAM': {
        const count = await this.services.cache.slidingWindow(
          'automod:spam',
          `${message.guildId}:${member.id}`,
          message.id,
          config.windowSeconds * 1000,
        );
        return count > config.threshold
          ? build(`Spam erkannt: ${count} Nachrichten in ${config.windowSeconds}s`, 0.9)
          : null;
      }
      case 'ANTI_FLOOD': {
        // Wiederholung derselben Nachricht ("Copy-Paste-Flood").
        const fingerprint = normalizeForFilter(content).slice(0, 64);
        if (fingerprint.length < 3) return null;
        const count = await this.services.cache.slidingWindow(
          'automod:flood',
          `${message.guildId}:${member.id}:${fingerprint}`,
          message.id,
          config.windowSeconds * 1000,
        );
        return count > config.threshold ? build(`Identische Nachricht ${count}× wiederholt`, 0.85) : null;
      }
      case 'ANTI_CAPS': {
        const ratio = capsRatio(content) * 100;
        return ratio >= config.threshold
          ? build(`Zu viele Grossbuchstaben (${Math.round(ratio)}%)`, 0.7)
          : null;
      }
      case 'ANTI_INVITE': {
        const matches = content.match(INVITE_PATTERN);
        return matches ? build(`Discord-Einladung erkannt: ${matches[0]}`, 0.95) : null;
      }
      case 'ANTI_LINK': {
        const allowed = new Set((config.entries ?? []).map((entry) => entry.toLowerCase()));
        const hosts = extractHosts(content).filter(
          (host) => ![...allowed].some((entry) => host === entry || host.endsWith(`.${entry}`)),
        );
        return hosts.length > 0 ? build(`Nicht erlaubter Link: ${hosts[0]}`, 0.8) : null;
      }
      case 'ANTI_MENTION_SPAM': {
        const mentions = message.mentions.users.size + message.mentions.roles.size;
        if (mentions === 0) return null;
        const total = await this.services.cache.slidingWindow(
          'automod:mentions',
          `${message.guildId}:${member.id}`,
          `${message.id}:${mentions}`,
          config.windowSeconds * 1000,
        );
        return mentions > config.threshold || total > config.threshold
          ? build(`Mention-Spam (${mentions} Erwaehnungen)`, 0.85)
          : null;
      }
      case 'ANTI_SCAM': {
        const score = scamScore(content) * 100;
        return score >= config.threshold
          ? build(`Scam-Verdacht (Score ${Math.round(score)})`, score / 100)
          : null;
      }
      case 'ANTI_PHISHING': {
        const host = extractHosts(content).find((candidate) => isPhishingHost(candidate));
        return host ? build(`Phishing-Domain erkannt: ${host}`, 0.95) : null;
      }
      case 'BAD_WORDS': {
        const normalized = normalizeForFilter(content);
        const hit = (config.entries ?? [])
          .map((entry) => normalizeForFilter(entry))
          .filter(Boolean)
          .find((entry) => normalized.includes(entry));
        return hit ? build('Unerlaubter Begriff verwendet', 0.9) : null;
      }
      case 'RAID_DETECTION':
        // Raid-Erkennung haengt an Join-Events, nicht an Nachrichten.
        return null;
      default:
        return null;
    }
  }

  /**
   * Setzt eine erkannte Verletzung um.
   * Die eigentliche Moderationsaktion laeuft ueber den ModerationService,
   * damit sie dieselbe Fallhistorie und dieselben Logs erhaelt.
   */
  async enforce(
    message: Message,
    violation: AutomodViolation,
    execute: (
      action: 'WARN' | 'TIMEOUT' | 'KICK' | 'BAN',
      reason: string,
      durationMs?: number,
    ) => Promise<void>,
  ): Promise<void> {
    const reason = `AutoMod (${violation.rule}): ${violation.reason}`;

    if (violation.action !== 'LOG_ONLY') {
      await message.delete().catch(() => undefined);
    }

    switch (violation.action) {
      case 'WARN':
        await execute('WARN', reason);
        break;
      case 'TIMEOUT':
        await execute('TIMEOUT', reason, violation.timeoutMs ?? 300_000);
        break;
      case 'KICK':
        await execute('KICK', reason);
        break;
      case 'BAN':
        await execute('BAN', reason);
        break;
      default:
        break;
    }

    this.services.log.security('AutoMod ausgeloest', {
      guildId: message.guildId ?? undefined,
      userId: message.author.id,
      rule: violation.rule,
      action: violation.action,
      confidence: violation.confidence,
    });

    await this.services.publish('security.automod', {
      guildId: message.guildId,
      userId: message.author.id,
      rule: violation.rule,
      action: violation.action,
      reason: violation.reason,
    });
  }
}
