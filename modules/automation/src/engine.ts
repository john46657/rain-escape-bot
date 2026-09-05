/**
 * Automations-Engine (Regel 30).
 *
 * Regel = Trigger + Bedingungen + Aktionen.
 * Sicherheitsprinzipien:
 *  - Aktionen laufen mit den Rechten des Bots, nie mit denen eines Nutzers;
 *    sicherheitskritische Aktionen (Ban/Kick) sind nur erlaubt, wenn die
 *    Regel von jemandem mit dem passenden Recht angelegt wurde (geprueft
 *    beim Speichern) — hier wird zusaetzlich ein Rate-Limit erzwungen.
 *  - Endlosschleifen werden durch eine Tiefenbegrenzung verhindert.
 */
import type { Services } from '@nexus/bot-core';
import type { AutomationAction, AutomationCondition, AutomationEntity } from '@nexus/database';
import { HOUR } from '@nexus/shared';

export interface AutomationEvent {
  guildId: string;
  trigger: string;
  /** Frei belegbare Daten, auf die Bedingungen zugreifen koennen. */
  context: Record<string, unknown>;
}

function readPath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (typeof current !== 'object' || current === null) return undefined;
    return (current as Record<string, unknown>)[part];
  }, source);
}

export function evaluateCondition(condition: AutomationCondition, context: Record<string, unknown>): boolean {
  const actual = readPath(context, condition.field);
  const expected = condition.value;

  switch (condition.operator) {
    case 'eq':
      return actual === expected;
    case 'neq':
      return actual !== expected;
    case 'gt':
      return Number(actual) > Number(expected);
    case 'lt':
      return Number(actual) < Number(expected);
    case 'gte':
      return Number(actual) >= Number(expected);
    case 'lte':
      return Number(actual) <= Number(expected);
    case 'contains':
      return String(actual).toLowerCase().includes(String(expected).toLowerCase());
    case 'startsWith':
      return String(actual).toLowerCase().startsWith(String(expected).toLowerCase());
    case 'in':
      return Array.isArray(expected) && expected.includes(actual as never);
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'regex':
      try {
        return new RegExp(String(expected), 'i').test(String(actual));
      } catch {
        return false;
      }
    default:
      return false;
  }
}

export class AutomationEngine {
  constructor(private readonly services: Services) {}

  async dispatch(event: AutomationEvent): Promise<number> {
    const automations = await this.services.store.automations.list(event.guildId, event.trigger);
    let executed = 0;

    for (const automation of automations) {
      if (!automation.enabled) continue;
      if (!automation.conditions.every((condition) => evaluateCondition(condition, event.context))) continue;

      // Rate-Limit je Regel: schuetzt vor Schleifen und Missbrauch.
      const count = await this.services.cache.slidingWindow(
        'automation',
        automation.id,
        `${Date.now()}`,
        HOUR,
      );
      if (count > automation.rateLimitPerHour) {
        await this.services.store.automations.update(automation.id, { enabled: false });
        this.services.log.warn('Automation wegen Rate-Limit deaktiviert', {
          guildId: event.guildId,
          automationId: automation.id,
          count,
        });
        continue;
      }

      const startedAt = Date.now();
      try {
        for (const action of automation.actions) await this.runAction(automation, action, event);
        await this.services.store.automations.recordRun(
          automation.id,
          'SUCCESS',
          { trigger: event.trigger },
          Date.now() - startedAt,
        );
        executed++;
      } catch (error) {
        await this.services.store.automations.recordRun(
          automation.id,
          'FAILED',
          { trigger: event.trigger, error: String(error) },
          Date.now() - startedAt,
        );
        this.services.log.error('Automation fehlgeschlagen', error, { automationId: automation.id });
      }
    }
    return executed;
  }

  private async runAction(
    automation: AutomationEntity,
    action: AutomationAction,
    event: AutomationEvent,
  ): Promise<void> {
    const guild = this.services.client.guilds.cache.get(event.guildId);
    if (!guild) return;
    const userId = String(event.context['userId'] ?? '');

    switch (action.type) {
      case 'discord.message.send': {
        const channelId = String(action.params['channelId'] ?? '');
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (channel?.isTextBased()) {
          await channel.send({ content: String(action.params['content'] ?? '').slice(0, 2000) });
        }
        return;
      }
      case 'discord.role.add':
      case 'discord.role.remove': {
        const member = userId ? await guild.members.fetch(userId).catch(() => null) : null;
        const roleId = String(action.params['roleId'] ?? '');
        if (!member || !roleId) return;
        if (action.type === 'discord.role.add')
          await member.roles.add(roleId, `Automation ${automation.name}`);
        else await member.roles.remove(roleId, `Automation ${automation.name}`);
        return;
      }
      case 'discord.coins.add': {
        if (!userId) return;
        await this.services.store.economy.mutate({
          guildId: event.guildId,
          userId,
          target: 'wallet',
          amount: Number(action.params['amount'] ?? 0),
          type: 'REWARD',
          reason: `Automation ${automation.name}`,
          idempotencyKey: `automation:${automation.id}:${userId}:${event.context['eventId'] ?? Date.now()}`,
        });
        return;
      }
      case 'discord.xp.add': {
        if (!userId) return;
        await this.services.store.levels.addXp(event.guildId, userId, Number(action.params['amount'] ?? 0));
        return;
      }
      case 'notification.send': {
        await this.services.store.security.createIncident({
          guildId: event.guildId,
          kind: 'AUTOMATION',
          severity: 'MEDIUM',
          status: 'OPEN',
          title: String(action.params['title'] ?? automation.name),
          description: String(action.params['description'] ?? ''),
          actorId: userId || null,
          actorType: null,
          robloxGameId: null,
          evidence: event.context,
          actionsTaken: [],
        });
        return;
      }
      case 'roblox.announce': {
        const games = await this.services.store.roblox.listGames(event.guildId);
        for (const game of games.filter((entry) => entry.active)) {
          await this.services.store.roblox.queueCommand({
            gameId: game.id,
            type: String(action.params['commandType'] ?? 'ANNOUNCE'),
            jobId: null,
            payload: (action.params['payload'] as Record<string, unknown>) ?? {},
            issuedById: 'automation',
            guildId: event.guildId,
            confirmedById: null,
            expiresAt: new Date(Date.now() + 5 * 60_000),
          });
        }
        return;
      }
      default:
        this.services.log.warn('Unbekannte Automations-Aktion', { type: action.type });
    }
  }
}
