/**
 * Typisierter Client fuer die Roblox-Plattform.
 *
 * Es werden ausschliesslich real existierende, oeffentlich dokumentierte
 * Endpunkte verwendet (Regel 52):
 *   - users.roblox.com       Nutzerprofile und Namensaufloesung
 *   - thumbnails.roblox.com  Avatare
 *   - groups.roblox.com      Gruppenmitgliedschaften und Raenge
 *   - games.roblox.com       Universe-Informationen
 *   - apis.roblox.com        Open Cloud (MessagingService, DataStore)
 *
 * Open-Cloud-Funktionen benoetigen einen API-Key mit den passenden
 * Berechtigungen; ohne Key werfen sie einen sprechenden Fehler statt
 * stillschweigend fehlzuschlagen.
 */
import { HOUR, MINUTE, NexusError, PreconditionError } from '@nexus/shared';
import { RobloxHttp } from './http.js';
import {
  type RobloxGroupRole,
  type RobloxUniverse,
  type RobloxUser,
  robloxGroupRoleSchema,
  robloxUniverseSchema,
  robloxUserSchema,
} from './types.js';

export interface RobloxClientOptions {
  apiKey?: string;
  /** Optionaler Cache; ohne ihn werden alle Anfragen direkt gestellt. */
  cache?: {
    getJson<T>(key: string): Promise<T | null>;
    setJson(key: string, value: unknown, ttlMs?: number): Promise<void>;
  };
}

export class RobloxClient {
  private readonly http: RobloxHttp;
  private readonly openCloud: RobloxHttp;

  constructor(private readonly options: RobloxClientOptions = {}) {
    this.http = new RobloxHttp({ timeoutMs: 10_000 });
    this.openCloud = new RobloxHttp({ timeoutMs: 10_000, apiKey: options.apiKey });
  }

  get hasOpenCloudAccess(): boolean {
    return Boolean(this.options.apiKey);
  }

  private async cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    if (!this.options.cache) return loader();
    const hit = await this.options.cache.getJson<T>(key);
    if (hit !== null) return hit;
    const value = await loader();
    await this.options.cache.setJson(key, value, ttlMs);
    return value;
  }

  // ------------------------------------------------------------- Nutzer
  async getUser(robloxUserId: string): Promise<RobloxUser | null> {
    return this.cached(`roblox:user:${robloxUserId}`, 10 * MINUTE, async () => {
      try {
        const data = await this.http.request<unknown>(`https://users.roblox.com/v1/users/${robloxUserId}`);
        return robloxUserSchema.parse(data);
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    });
  }

  /** Loest Benutzernamen in IDs auf (Batch-Endpunkt, max. 100 Namen). */
  async getUsersByUsernames(usernames: string[]): Promise<RobloxUser[]> {
    if (usernames.length === 0) return [];
    const response = await this.http.request<{ data?: unknown[] }>(
      'https://users.roblox.com/v1/usernames/users',
      {
        method: 'POST',
        body: JSON.stringify({ usernames: usernames.slice(0, 100), excludeBannedUsers: false }),
      },
    );
    return (response.data ?? [])
      .map((entry) => robloxUserSchema.safeParse(entry))
      .filter((result): result is { success: true; data: RobloxUser } => result.success)
      .map((result) => result.data);
  }

  async getUserByUsername(username: string): Promise<RobloxUser | null> {
    const [user] = await this.getUsersByUsernames([username]);
    return user ?? null;
  }

  async getAvatarUrl(robloxUserId: string, size: '150x150' | '420x420' = '420x420'): Promise<string | null> {
    return this.cached(`roblox:avatar:${robloxUserId}:${size}`, HOUR, async () => {
      const response = await this.http.request<{ data?: Array<{ imageUrl?: string; state?: string }> }>(
        `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${robloxUserId}&size=${size}&format=Png&isCircular=false`,
      );
      const entry = response.data?.[0];
      return entry?.state === 'Completed' ? (entry.imageUrl ?? null) : null;
    });
  }

  // ------------------------------------------------------------ Gruppen
  async getUserGroups(robloxUserId: string): Promise<RobloxGroupRole[]> {
    return this.cached(`roblox:groups:${robloxUserId}`, 5 * MINUTE, async () => {
      const response = await this.http.request<{ data?: unknown[] }>(
        `https://groups.roblox.com/v2/users/${robloxUserId}/groups/roles`,
      );
      return (response.data ?? [])
        .map((entry) => robloxGroupRoleSchema.safeParse(entry))
        .filter((result): result is { success: true; data: RobloxGroupRole } => result.success)
        .map((result) => result.data);
    });
  }

  /** Rang eines Nutzers in einer bestimmten Gruppe (0 = kein Mitglied). */
  async getGroupRank(
    robloxUserId: string,
    groupId: string,
  ): Promise<{ rank: number; roleName: string } | null> {
    const groups = await this.getUserGroups(robloxUserId);
    const membership = groups.find((entry) => String(entry.group.id) === String(groupId));
    return membership ? { rank: membership.role.rank, roleName: membership.role.name } : null;
  }

  // ------------------------------------------------------------- Spiele
  async getUniverse(universeId: string): Promise<RobloxUniverse | null> {
    return this.cached(`roblox:universe:${universeId}`, 5 * MINUTE, async () => {
      const response = await this.http.request<{ data?: unknown[] }>(
        `https://games.roblox.com/v1/games?universeIds=${universeId}`,
      );
      const entry = response.data?.[0];
      if (!entry) return null;
      const parsed = robloxUniverseSchema.safeParse(entry);
      return parsed.success ? parsed.data : null;
    });
  }

  // --------------------------------------------------------- Open Cloud
  /**
   * Sendet eine Nachricht ueber den MessagingService an alle laufenden
   * Server eines Universums. Das Spiel muss `MessagingService:SubscribeAsync`
   * auf dasselbe Topic abonnieren (siehe NexusServer.luau).
   *
   * Voraussetzung: Open-Cloud-API-Key mit der Berechtigung
   * "universe-messaging-service:publish" fuer dieses Universum.
   */
  async publishMessage(universeId: string, topic: string, message: unknown): Promise<void> {
    this.assertOpenCloud('MessagingService');
    await this.openCloud.request<void>(
      `https://apis.roblox.com/messaging-service/v1/universes/${universeId}/topics/${encodeURIComponent(topic)}`,
      { method: 'POST', body: JSON.stringify({ message: JSON.stringify(message) }) },
    );
  }

  /**
   * Schreibt einen Eintrag in einen Standard-DataStore (Open Cloud).
   * Wird fuer Cross-Platform-Rewards genutzt, wenn kein Server online ist.
   */
  async setDataStoreEntry(
    universeId: string,
    datastoreName: string,
    entryKey: string,
    value: unknown,
    scope = 'global',
  ): Promise<void> {
    this.assertOpenCloud('DataStore');
    const url = new URL(
      `https://apis.roblox.com/datastores/v1/universes/${universeId}/standard-datastores/datastore/entries/entry`,
    );
    url.searchParams.set('datastoreName', datastoreName);
    url.searchParams.set('entryKey', entryKey);
    url.searchParams.set('scope', scope);
    await this.openCloud.request<void>(url.toString(), {
      method: 'POST',
      body: JSON.stringify(value),
      headers: { 'content-type': 'application/json' },
    });
  }

  async getDataStoreEntry<T>(
    universeId: string,
    datastoreName: string,
    entryKey: string,
    scope = 'global',
  ): Promise<T | null> {
    this.assertOpenCloud('DataStore');
    const url = new URL(
      `https://apis.roblox.com/datastores/v1/universes/${universeId}/standard-datastores/datastore/entries/entry`,
    );
    url.searchParams.set('datastoreName', datastoreName);
    url.searchParams.set('entryKey', entryKey);
    url.searchParams.set('scope', scope);
    try {
      return await this.openCloud.request<T>(url.toString());
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  private assertOpenCloud(feature: string): void {
    if (!this.options.apiKey) {
      throw new PreconditionError(
        `${feature} erfordert einen Roblox-Open-Cloud-API-Key (ROBLOX_API_KEY). ` +
          'Ohne Key stellt NEXUS Kommandos in die Warteschlange, die der Game-Server abholt.',
      );
    }
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof NexusError && Number(error.meta['status'] ?? 0) === 404;
}
