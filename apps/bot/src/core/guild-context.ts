import type { CacheService } from '@nexus/cache';
import type { DataStore, GuildConfigEntity } from '@nexus/database';
import type {
  PermissionGrant,
  PermissionNode,
  PermissionService,
  PermissionSubject,
} from '@nexus/permissions';
import { ForbiddenError, MINUTE, type Locale, type PremiumTier } from '@nexus/shared';

/**
 * Zentrale Aufloesung von Guild-Konfiguration, Premium-Tier und Rechten.
 *
 * Alles wird in Redis zwischengespeichert: pro Interaktion wuerden sonst
 * mehrere Datenbankabfragen anfallen (Regel 42).
 */
export class GuildContextService {
  private static readonly CONFIG_TTL = 5 * MINUTE;
  private static readonly GRANTS_TTL = 5 * MINUTE;

  constructor(
    private readonly store: DataStore,
    private readonly cache: CacheService,
    private readonly permissions: PermissionService,
    private readonly ownerIds: string[],
  ) {}

  async config(guildId: string): Promise<GuildConfigEntity> {
    const cached = await this.cache.getJson<GuildConfigEntity>(`config:${guildId}`);
    if (cached) return cached;
    const config = await this.store.guilds.getConfig(guildId);
    await this.cache.setJson(`config:${guildId}`, config, GuildContextService.CONFIG_TTL);
    return config;
  }

  async updateConfig(guildId: string, patch: Partial<GuildConfigEntity>): Promise<GuildConfigEntity> {
    const updated = await this.store.guilds.updateConfig(guildId, patch);
    await this.cache.setJson(`config:${guildId}`, updated, GuildContextService.CONFIG_TTL);
    return updated;
  }

  async invalidate(guildId: string): Promise<void> {
    await this.cache.delete(`config:${guildId}`, `grants:${guildId}`, `tier:${guildId}`);
  }

  async tier(guildId: string): Promise<PremiumTier> {
    const cached = await this.cache.getJson<{ tier: PremiumTier }>(`tier:${guildId}`);
    if (cached) return cached.tier;
    const guild = await this.store.guilds.findByDiscordId(guildId);
    const expired = guild?.premiumUntil ? guild.premiumUntil.getTime() < Date.now() : false;
    const tier: PremiumTier = !guild || expired ? 'FREE' : guild.premiumTier;
    await this.cache.setJson(`tier:${guildId}`, { tier }, GuildContextService.CONFIG_TTL);
    return tier;
  }

  async locale(guildId: string | null, userLocale: Locale): Promise<Locale> {
    if (!guildId) return userLocale;
    const guild = await this.store.guilds.findByDiscordId(guildId);
    return guild?.locale ?? userLocale;
  }

  private async grants(guildId: string): Promise<PermissionGrant[]> {
    const cached = await this.cache.getJson<PermissionGrant[]>(`grants:${guildId}`);
    if (cached) return cached;
    const rows = await this.store.guilds.listPermissionGrants(guildId);
    const grants: PermissionGrant[] = rows.map((row) => ({
      subjectId: row.subjectId,
      subjectType: row.subjectType,
      allow: row.allow,
      deny: row.deny,
    }));
    await this.cache.setJson(`grants:${guildId}`, grants, GuildContextService.GRANTS_TTL);
    return grants;
  }

  async can(subject: PermissionSubject, node: PermissionNode): Promise<boolean> {
    const enriched: PermissionSubject = { ...subject, isBotOwner: this.ownerIds.includes(subject.userId) };
    if (!subject.guildId) return enriched.isBotOwner === true;
    const grants = await this.grants(subject.guildId);
    return this.permissions.evaluate(enriched, node, grants).allowed;
  }

  async assert(subject: PermissionSubject, node: PermissionNode): Promise<void> {
    if (!(await this.can(subject, node))) {
      throw new ForbiddenError(`Fehlende Berechtigung: ${node}`, {
        node,
        userId: subject.userId,
        guildId: subject.guildId,
      });
    }
  }

  async resolveNodes(subject: PermissionSubject): Promise<PermissionNode[]> {
    const enriched: PermissionSubject = { ...subject, isBotOwner: this.ownerIds.includes(subject.userId) };
    const grants = subject.guildId ? await this.grants(subject.guildId) : [];
    return this.permissions.resolve(enriched, grants);
  }
}
