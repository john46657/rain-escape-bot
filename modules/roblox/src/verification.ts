/**
 * Roblox-Verifizierung (Regel 20).
 *
 * Ablauf:
 *  1. `/verify` erzeugt einen Einmalcode. Gespeichert wird ausschliesslich
 *     ein scrypt-Hash plus ein kurzer, nicht geheimer "Hint" fuer die Suche.
 *  2. Der Nutzer gibt den Code im Roblox-Spiel ein.
 *  3. Der Game-Server sendet ihn signiert an `/api/v1/roblox/verify`.
 *     Erst dort wird geprueft — die Roblox-UserId stammt vom Server
 *     (`Player.UserId`), nie aus einer Client-Eingabe (Regel 53).
 *  4. Bei Erfolg wird die Verknuepfung angelegt und Rollen/Nickname gesetzt.
 *
 * Sicherheitsmerkmale: Codes sind einmalig, laufen ab, haben ein
 * Versuchslimit, und eine Roblox-ID kann nur einem Discord-Konto gehoeren.
 */
import type { Guild, GuildMember } from 'discord.js';
import { writeAudit, type Services } from '@nexus/bot-core';
import type { RobloxAccountEntity } from '@nexus/database';
import { hashSecret, verifySecret } from '@nexus/security';
import { ConflictError, MINUTE, PreconditionError, randomCode } from '@nexus/shared';

export interface VerificationTicket {
  code: string;
  expiresAt: Date;
}

/** Gueltigkeitsdauer eines Verifizierungscodes. */
export const VERIFICATION_TTL_MS = 15 * MINUTE;

export class VerificationService {
  constructor(private readonly services: Services) {}

  /**
   * Erstellt einen neuen Einmalcode.
   * Der Klartext wird nur zurueckgegeben, nie gespeichert.
   */
  async createTicket(discordId: string, guildId: string | null): Promise<VerificationTicket> {
    const existing = await this.services.store.roblox.getAccountByDiscordId(discordId);
    if (existing) {
      throw new ConflictError(`Bereits verknuepft mit ${existing.username}`, {
        username: existing.username, robloxUserId: existing.robloxUserId,
      });
    }

    // Aeltere offene Codes entwerten — es darf immer nur einer gueltig sein.
    await this.services.store.verification.invalidateForUser(discordId);

    const code = `NX-${randomCode(6)}`;
    const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);

    await this.services.store.users.upsertFromDiscord({ discordId, username: discordId });
    await this.services.store.verification.create({
      userId: discordId,
      discordId,
      codeHash: await hashSecret(code),
      // Hint = die letzten 4 Zeichen: erlaubt eine indizierte Suche,
      // ohne den Code preiszugeben (Brute-Force bleibt durch das
      // Versuchslimit und die Ablaufzeit unattraktiv).
      codeHint: code.slice(-4).toUpperCase(),
      guildId,
      expiresAt,
    });

    this.services.log.info('Verifizierungscode erstellt', { userId: discordId, guildId: guildId ?? undefined });
    return { code, expiresAt };
  }

  /**
   * Prueft einen Code (wird von der API aufgerufen, nicht vom Bot).
   * Gibt bei Erfolg die verknuepfte Discord-ID zurueck.
   */
  async redeem(code: string, robloxUserId: string, robloxUsername: string, displayName?: string): Promise<{
    discordId: string;
    account: RobloxAccountEntity;
  }> {
    const normalized = code.trim().toUpperCase();
    const candidates = await this.services.store.verification.findActiveByHint(normalized.slice(-4));

    for (const candidate of candidates) {
      const attempts = await this.services.store.verification.incrementAttempts(candidate.id);
      if (attempts > candidate.maxAttempts) continue;
      if (!(await verifySecret(normalized, candidate.codeHash))) continue;

      const existing = await this.services.store.roblox.getAccountByRobloxId(robloxUserId);
      if (existing && existing.discordId !== candidate.discordId) {
        throw new ConflictError('Dieser Roblox-Account ist bereits mit einem anderen Discord-Konto verknuepft');
      }

      const account = await this.services.store.roblox.linkAccount({
        userId: candidate.userId,
        discordId: candidate.discordId,
        robloxUserId,
        username: robloxUsername,
        displayName: displayName ?? null,
        avatarUrl: await this.services.roblox.getAvatarUrl(robloxUserId).catch(() => null),
        method: 'game',
      });
      await this.services.store.verification.markVerified(candidate.id, robloxUserId);

      this.services.log.security('Roblox-Konto verifiziert', {
        userId: candidate.discordId, robloxUserId, guildId: candidate.guildId ?? undefined,
      });
      await writeAudit(this.services, {
        guildId: candidate.guildId,
        actorId: candidate.discordId,
        actorType: 'api',
        action: 'roblox.verify.success',
        targetId: robloxUserId,
        targetType: 'roblox_user',
        result: 'SUCCESS',
        reason: null,
        metadata: { username: robloxUsername },
      });

      // Rollen und Nickname im Zielserver setzen (best effort).
      if (candidate.guildId) {
        const guild = this.services.client.guilds.cache.get(candidate.guildId);
        if (guild) await this.applyVerifiedState(guild, candidate.discordId, account).catch(() => undefined);
      }

      await this.services.publish('roblox.verified', {
        discordId: candidate.discordId, robloxUserId, username: robloxUsername,
      });

      return { discordId: candidate.discordId, account };
    }

    throw new PreconditionError('Ungueltiger, abgelaufener oder bereits genutzter Code');
  }

  /** Setzt die verifizierte Rolle und den Nickname gemaess Guild-Konfiguration. */
  async applyVerifiedState(guild: Guild, discordId: string, account: RobloxAccountEntity): Promise<void> {
    const config = await this.services.guildContext.config(guild.id);
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) return;

    if (config.verifiedRoleId) {
      await member.roles.add(config.verifiedRoleId, 'NEXUS: Roblox verifiziert').catch(() => undefined);
    }
    if (config.unverifiedRoleId && member.roles.cache.has(config.unverifiedRoleId)) {
      await member.roles.remove(config.unverifiedRoleId, 'NEXUS: Roblox verifiziert').catch(() => undefined);
    }
    if (config.robloxNicknameSync) {
      await this.syncNickname(member, account, config.nicknameTemplate);
    }
    await this.syncGroupRoles(guild, member, account);
  }

  async syncNickname(member: GuildMember, account: RobloxAccountEntity, template: string): Promise<void> {
    if (member.id === member.guild.ownerId) return; // Discord verbietet das Umbenennen des Owners.
    const nickname = template
      .replace('{robloxUsername}', account.username)
      .replace('{robloxDisplayName}', account.displayName ?? account.username)
      .replace('{discordUsername}', member.user.username)
      .slice(0, 32);
    if (member.nickname === nickname) return;
    await member.setNickname(nickname, 'NEXUS: Roblox-Namenssynchronisation').catch(() => undefined);
  }

  /**
   * Synchronisiert Discord-Rollen anhand der Roblox-Gruppenraenge (Regel 21).
   * Rollen werden nur innerhalb der konfigurierten Zuordnung veraendert —
   * andere Rollen bleiben unangetastet.
   */
  async syncGroupRoles(guild: Guild, member: GuildMember, account: RobloxAccountEntity): Promise<number> {
    const groups = await this.services.store.roblox.listGroups(guild.id);
    if (groups.length === 0) return 0;

    const memberships = await this.services.roblox.getUserGroups(account.robloxUserId).catch(() => []);
    let changes = 0;

    for (const group of groups) {
      if (!group.syncEnabled) continue;
      const membership = memberships.find((entry) => String(entry.group.id) === group.groupId);
      const managedRoleIds = group.rankMapping.map((mapping) => mapping.roleId);

      const targetRoleIds = membership
        ? group.rankMapping
            .filter((mapping) => membership.role.rank >= mapping.rank)
            .map((mapping) => mapping.roleId)
        : [];

      for (const roleId of managedRoleIds) {
        const shouldHave = targetRoleIds.includes(roleId);
        const hasRole = member.roles.cache.has(roleId);
        if (shouldHave && !hasRole) {
          await member.roles.add(roleId, `NEXUS Gruppen-Sync (${group.name})`).catch(() => undefined);
          changes++;
        } else if (!shouldHave && hasRole && group.removeOnLeave) {
          await member.roles.remove(roleId, `NEXUS Gruppen-Sync (${group.name})`).catch(() => undefined);
          changes++;
        }
      }
      await this.services.store.roblox.setGroupSynced(group.id, new Date());
    }
    return changes;
  }
}
