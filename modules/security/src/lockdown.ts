/**
 * Notfallmodus / Lockdown (Regel 8).
 *
 * Beim Aktivieren wird der vorherige Zustand jedes Kanals gesichert, damit
 * das Aufheben exakt wiederherstellt (und nicht pauschal "erlauben" setzt).
 * Das Deaktivieren erfordert eine eigene Berechtigung.
 */
import { ChannelType, PermissionFlagsBits, type Guild, type OverwriteResolvable } from 'discord.js';
import { embeds, writeAudit, type Services } from '@nexus/bot-core';
import { PreconditionError } from '@nexus/shared';

export interface LockdownResult {
  affected: number;
  skipped: number;
}

export class LockdownService {
  constructor(private readonly services: Services) {}

  async enable(guild: Guild, actorId: string, reason: string, channelIds?: string[]): Promise<LockdownResult> {
    const config = await this.services.guildContext.config(guild.id);
    if (config.lockdownActive) throw new PreconditionError('Der Notfallmodus ist bereits aktiv');

    const me = guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      throw new PreconditionError('Mir fehlt die Berechtigung "Kanaele verwalten"');
    }

    const everyone = guild.roles.everyone;
    const targets = [...guild.channels.cache.values()].filter(
      (channel) =>
        channel.type === ChannelType.GuildText &&
        (!channelIds?.length || channelIds.includes(channel.id)),
    );

    const snapshot: Array<{ channelId: string; previousOverwrites: unknown }> = [];
    let affected = 0;
    let skipped = 0;

    for (const channel of targets) {
      if (!channel.isTextBased() || !('permissionOverwrites' in channel)) continue;
      const existing = channel.permissionOverwrites.cache.get(everyone.id);
      snapshot.push({
        channelId: channel.id,
        previousOverwrites: existing
          ? { allow: existing.allow.bitfield.toString(), deny: existing.deny.bitfield.toString() }
          : null,
      });
      const updated = await channel.permissionOverwrites
        .edit(everyone, { SendMessages: false, AddReactions: false, CreatePublicThreads: false }, { reason: `NEXUS Lockdown: ${reason}` })
        .then(() => true)
        .catch(() => false);
      if (updated) affected++;
      else skipped++;
    }

    await this.services.guildContext.updateConfig(guild.id, {
      lockdownActive: true,
      lockdownReason: reason,
      lockdownAt: new Date(),
      lockdownBy: actorId,
      lockdownSnapshot: snapshot,
      // Join-Schutz: neue Konten werden waehrend des Lockdowns geprueft.
      raidModeEnabled: true,
    });

    await this.services.store.security.createIncident({
      guildId: guild.id,
      kind: 'LOCKDOWN',
      severity: 'CRITICAL',
      status: 'OPEN',
      title: 'Notfallmodus aktiviert',
      description: reason,
      actorId,
      actorType: 'discord',
      robloxGameId: null,
      evidence: { channels: affected, skipped },
      actionsTaken: [`${affected} Kanaele gesperrt`, 'Join-Schutz aktiviert'],
    });

    await writeAudit(this.services, {
      guildId: guild.id, actorId, actorType: 'discord', action: 'security.lockdown.enable',
      targetId: guild.id, targetType: 'guild', result: 'SUCCESS', reason,
      metadata: { affected, skipped },
    });

    this.services.log.security('Lockdown aktiviert', { guildId: guild.id, userId: actorId, affected });
    await this.notify(guild, `🔒 **Notfallmodus aktiviert** durch <@${actorId}>\n**Grund:** ${reason}`);
    await this.services.publish('security.lockdown', { guildId: guild.id, active: true, actorId });

    return { affected, skipped };
  }

  async disable(guild: Guild, actorId: string): Promise<LockdownResult> {
    const config = await this.services.guildContext.config(guild.id);
    if (!config.lockdownActive) throw new PreconditionError('Der Notfallmodus ist nicht aktiv');

    const everyone = guild.roles.everyone;
    let affected = 0;
    let skipped = 0;

    for (const entry of config.lockdownSnapshot) {
      const channel = await guild.channels.fetch(entry.channelId).catch(() => null);
      if (!channel || !('permissionOverwrites' in channel)) { skipped++; continue; }

      const previous = entry.previousOverwrites as { allow: string; deny: string } | null;
      const restored = await (previous
        ? channel.permissionOverwrites.set(
            [
              ...channel.permissionOverwrites.cache
                .filter((overwrite) => overwrite.id !== everyone.id)
                .map((overwrite) => ({
                  id: overwrite.id, type: overwrite.type,
                  allow: overwrite.allow, deny: overwrite.deny,
                })) as OverwriteResolvable[],
              { id: everyone.id, allow: BigInt(previous.allow), deny: BigInt(previous.deny) },
            ],
            `NEXUS Lockdown aufgehoben — ${actorId}`,
          )
        : channel.permissionOverwrites.edit(
            everyone,
            { SendMessages: null, AddReactions: null, CreatePublicThreads: null },
            { reason: `NEXUS Lockdown aufgehoben — ${actorId}` },
          )
      )
        .then(() => true)
        .catch(() => false);

      if (restored) affected++;
      else skipped++;
    }

    await this.services.guildContext.updateConfig(guild.id, {
      lockdownActive: false,
      lockdownReason: null,
      lockdownAt: null,
      lockdownBy: null,
      lockdownSnapshot: [],
      raidModeEnabled: false,
    });

    await writeAudit(this.services, {
      guildId: guild.id, actorId, actorType: 'discord', action: 'security.lockdown.disable',
      targetId: guild.id, targetType: 'guild', result: 'SUCCESS', reason: null,
      metadata: { affected, skipped },
    });

    this.services.log.security('Lockdown aufgehoben', { guildId: guild.id, userId: actorId, affected });
    await this.notify(guild, `🔓 **Notfallmodus aufgehoben** durch <@${actorId}>`);
    await this.services.publish('security.lockdown', { guildId: guild.id, active: false, actorId });

    return { affected, skipped };
  }

  private async notify(guild: Guild, message: string): Promise<void> {
    const config = await this.services.guildContext.config(guild.id);
    const channelId = config.securityChannelId ?? config.modLogChannelId;
    if (!channelId) return;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased()) {
      await channel.send({ embeds: [embeds.security('Notfallmodus', message)] }).catch(() => undefined);
    }
  }
}
