/**
 * In-Memory-Implementierung aller Repository-Ports.
 *
 * Einsatz:
 *   - Unit-Tests (deterministisch, ohne Docker)
 *   - DEV_MODE / Demo-Betrieb des Dashboards ohne PostgreSQL
 *
 * Die Semantik (Atomarität, Idempotenz, Sortierung, Fehlerfaelle) entspricht
 * bewusst dem Prisma-Adapter, damit Tests aussagekraeftig bleiben.
 * Node.js ist single-threaded und dieser Store nutzt keine `await`-Punkte
 * innerhalb kritischer Abschnitte — dadurch sind die Mutationen atomar.
 */
import { ConflictError, NotFoundError, PreconditionError, formatCaseId, uuid } from '@nexus/shared';
import type {
  AchievementEntity,
  AnalyticsSnapshotEntity,
  ApiKeyEntity,
  AuditLogEntity,
  AutomationEntity,
  BackupEntity,
  EconomyProfileEntity,
  GiveawayEntity,
  GuildConfigEntity,
  GuildEntity,
  InventoryEntryEntity,
  ItemEntity,
  ModerationCaseEntity,
  NotificationEntity,
  PermissionGrantEntity,
  PromoCodeEntity,
  RewardGrantEntity,
  RobloxAccountEntity,
  RobloxCommandEntity,
  RobloxEventEntity,
  RobloxGameEntity,
  RobloxGroupEntity,
  RobloxServerEntity,
  SecurityIncidentEntity,
  TicketEntity,
  TicketMessageEntity,
  TransactionEntity,
  UserEntity,
  VerificationEntity,
  WarningEntity,
  XPProfileEntity,
} from '../entities.js';
import { defaultGuildConfig, emptyXpProfile } from '../defaults.js';
import { levelFromTotalXp } from '../leveling.js';
import type * as P from '../ports.js';

const page = <T>(items: T[], query?: P.PageQuery): P.Page<T> => {
  const pageNumber = Math.max(1, query?.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, query?.pageSize ?? 25));
  return {
    items: items.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
    total: items.length,
    page: pageNumber,
    pageSize,
  };
};

const byNewest = <T extends { createdAt: Date }>(a: T, b: T): number =>
  b.createdAt.getTime() - a.createdAt.getTime();

export class MemoryDataStore implements P.DataStore {
  readonly kind = 'memory' as const;

  // ---- Rohdaten (oeffentlich fuer Seeding/Tests) ----
  readonly data = {
    users: new Map<string, UserEntity>(),
    guilds: new Map<string, GuildEntity>(),
    configs: new Map<string, GuildConfigEntity>(),
    grants: new Map<string, PermissionGrantEntity>(),
    cases: [] as ModerationCaseEntity[],
    caseSequence: new Map<string, number>(),
    warnings: [] as WarningEntity[],
    incidents: [] as SecurityIncidentEntity[],
    audit: [] as AuditLogEntity[],
    tickets: [] as TicketEntity[],
    ticketMessages: [] as TicketMessageEntity[],
    ticketSequence: new Map<string, number>(),
    xp: new Map<string, XPProfileEntity>(),
    levelRewards: new Map<
      string,
      Array<{ level: number; roleId: string | null; coins: number; removePrevious: boolean }>
    >(),
    economy: new Map<string, EconomyProfileEntity>(),
    transactions: [] as TransactionEntity[],
    idempotency: new Set<string>(),
    items: [] as ItemEntity[],
    inventory: new Map<string, Map<string, number>>(),
    verifications: [] as VerificationEntity[],
    robloxAccounts: new Map<string, RobloxAccountEntity>(),
    games: [] as RobloxGameEntity[],
    servers: [] as RobloxServerEntity[],
    events: [] as RobloxEventEntity[],
    eventRoutes: [] as Array<{
      guildId: string;
      gameId: string | null;
      eventType: string;
      channelId: string;
      enabled: boolean;
      filter: Record<string, unknown>;
    }>,
    commands: [] as RobloxCommandEntity[],
    groups: [] as RobloxGroupEntity[],
    sessions: [] as Array<{
      gameId: string;
      robloxUserId: string;
      jobId: string | null;
      joinedAt: Date;
      leftAt: Date | null;
    }>,
    rewards: [] as RewardGrantEntity[],
    achievements: [] as AchievementEntity[],
    unlocks: [] as Array<{ achievementId: string; userId: string; guildId: string; unlockedAt: Date }>,
    promos: [] as PromoCodeEntity[],
    redemptions: [] as Array<{ codeId: string; userId: string }>,
    giveaways: [] as GiveawayEntity[],
    automations: [] as AutomationEntity[],
    backups: [] as Array<BackupEntity & { payload: unknown }>,
    apiKeys: [] as ApiKeyEntity[],
    apiRequests: [] as Array<{
      apiKeyId: string;
      method: string;
      path: string;
      statusCode: number;
      durationMs: number;
      createdAt: Date;
    }>,
    notifications: [] as NotificationEntity[],
    analytics: [] as AnalyticsSnapshotEntity[],
  };

  private key(...parts: string[]): string {
    return parts.join(':');
  }

  async healthy(): Promise<boolean> {
    return true;
  }
  async disconnect(): Promise<void> {
    /* nichts zu tun */
  }

  // =========================================================== Users
  users: P.UserRepository = {
    upsertFromDiscord: async (input) => {
      const existing = this.data.users.get(input.discordId);
      const user: UserEntity = existing
        ? {
            ...existing,
            username: input.username,
            globalName: input.globalName ?? existing.globalName,
            avatar: input.avatar ?? existing.avatar,
            lastSeenAt: new Date(),
          }
        : {
            id: input.discordId,
            discordId: input.discordId,
            username: input.username,
            globalName: input.globalName ?? null,
            avatar: input.avatar ?? null,
            locale: 'de',
            isBotOwner: false,
            blacklisted: false,
            createdAt: new Date(),
            lastSeenAt: new Date(),
          };
      this.data.users.set(user.discordId, user);
      return user;
    },
    findByDiscordId: async (discordId) => this.data.users.get(discordId) ?? null,
    setLocale: async (discordId, locale) => {
      const user = this.data.users.get(discordId);
      if (user) this.data.users.set(discordId, { ...user, locale });
    },
    setBlacklist: async (discordId, blacklisted) => {
      const user = this.data.users.get(discordId);
      if (user) this.data.users.set(discordId, { ...user, blacklisted });
    },
  };

  // ========================================================== Guilds
  guilds: P.GuildRepository = {
    upsert: async (input) => {
      const existing = this.data.guilds.get(input.discordId);
      const guild: GuildEntity = existing
        ? {
            ...existing,
            name: input.name,
            icon: input.icon ?? existing.icon,
            ownerId: input.ownerId,
            memberCount: input.memberCount ?? existing.memberCount,
            active: true,
          }
        : {
            id: input.discordId,
            discordId: input.discordId,
            name: input.name,
            icon: input.icon ?? null,
            ownerId: input.ownerId,
            memberCount: input.memberCount ?? 0,
            premiumTier: 'FREE',
            premiumUntil: null,
            locale: 'de',
            active: true,
            joinedAt: new Date(),
          };
      this.data.guilds.set(guild.discordId, guild);
      if (!this.data.configs.has(guild.discordId)) {
        this.data.configs.set(guild.discordId, defaultGuildConfig(guild.discordId));
      }
      return guild;
    },
    findByDiscordId: async (discordId) => this.data.guilds.get(discordId) ?? null,
    list: async (query) => {
      const items = [...this.data.guilds.values()].filter(
        (g) => query?.active === undefined || g.active === query.active,
      );
      return page(items, query);
    },
    markInactive: async (discordId) => {
      const guild = this.data.guilds.get(discordId);
      if (guild) this.data.guilds.set(discordId, { ...guild, active: false });
    },
    setPremium: async (discordId, tier, until) => {
      const guild = this.data.guilds.get(discordId);
      if (guild)
        this.data.guilds.set(discordId, { ...guild, premiumTier: tier, premiumUntil: until ?? null });
    },
    getConfig: async (guildId) => {
      let config = this.data.configs.get(guildId);
      if (!config) {
        config = defaultGuildConfig(guildId);
        this.data.configs.set(guildId, config);
      }
      return config;
    },
    updateConfig: async (guildId, patch) => {
      const current = this.data.configs.get(guildId) ?? defaultGuildConfig(guildId);
      const updated = { ...current, ...patch, guildId };
      this.data.configs.set(guildId, updated);
      return updated;
    },
    listPermissionGrants: async (guildId) =>
      [...this.data.grants.values()].filter((g) => g.guildId === guildId),
    upsertPermissionGrant: async (input) => {
      const key = this.key(input.guildId, input.subjectId, input.subjectType);
      const existing = this.data.grants.get(key);
      const grant: PermissionGrantEntity = { id: existing?.id ?? uuid(), ...input };
      this.data.grants.set(key, grant);
      return grant;
    },
  };

  // ====================================================== Moderation
  moderation: P.ModerationRepository = {
    createCase: async (input) => {
      const sequence = (this.data.caseSequence.get(input.guildId) ?? 0) + 1;
      this.data.caseSequence.set(input.guildId, sequence);
      const entity: ModerationCaseEntity = {
        id: uuid(),
        guildId: input.guildId,
        sequence,
        caseId: formatCaseId(input.guildId, sequence),
        action: input.action,
        targetId: input.targetId,
        targetTag: input.targetTag ?? null,
        moderatorId: input.moderatorId,
        moderatorTag: input.moderatorTag ?? null,
        reason: input.reason ?? 'Kein Grund angegeben',
        source: input.source ?? 'COMMAND',
        previousState: input.previousState ?? {},
        newState: input.newState ?? {},
        durationMs: input.durationMs ?? null,
        expiresAt: input.expiresAt ?? null,
        active: true,
        revoked: false,
        revokedById: null,
        revokedAt: null,
        logMessageId: null,
        createdAt: new Date(),
      };
      this.data.cases.push(entity);
      return entity;
    },
    getCase: async (guildId, caseId) =>
      this.data.cases.find((c) => c.guildId === guildId && (c.caseId === caseId || c.id === caseId)) ?? null,
    listCases: async (guildId, query) => {
      const items = this.data.cases
        .filter((c) => c.guildId === guildId)
        .filter((c) => !query?.targetId || c.targetId === query.targetId)
        .filter((c) => !query?.moderatorId || c.moderatorId === query.moderatorId)
        .filter((c) => !query?.action || c.action === query.action)
        .sort(byNewest);
      return page(items, query);
    },
    updateCase: async (id, patch) => {
      const index = this.data.cases.findIndex((c) => c.id === id);
      if (index >= 0) this.data.cases[index] = { ...this.data.cases[index]!, ...patch };
    },
    listExpiredCases: async (now, limit = 100) =>
      this.data.cases.filter((c) => c.active && c.expiresAt !== null && c.expiresAt <= now).slice(0, limit),
    addWarning: async (input) => {
      const warning: WarningEntity = {
        id: uuid(),
        guildId: input.guildId,
        caseRef: input.caseRef ?? null,
        targetId: input.targetId,
        moderatorId: input.moderatorId,
        reason: input.reason,
        points: input.points ?? 1,
        active: true,
        expiresAt: input.expiresAt ?? null,
        createdAt: new Date(),
      };
      this.data.warnings.push(warning);
      return warning;
    },
    listWarnings: async (guildId, targetId, activeOnly = true) =>
      this.data.warnings
        .filter((w) => w.guildId === guildId && w.targetId === targetId && (!activeOnly || w.active))
        .sort(byNewest),
    deactivateWarning: async (id) => {
      const warning = this.data.warnings.find((w) => w.id === id);
      if (!warning || !warning.active) return false;
      warning.active = false;
      return true;
    },
    expireWarnings: async (now) => {
      let count = 0;
      for (const warning of this.data.warnings) {
        if (warning.active && warning.expiresAt && warning.expiresAt <= now) {
          warning.active = false;
          count++;
        }
      }
      return count;
    },
  };

  // ======================================================== Security
  security: P.SecurityRepository = {
    createIncident: async (input) => {
      const incident: SecurityIncidentEntity = {
        id: uuid(),
        createdAt: new Date(),
        updatedAt: new Date(),
        acknowledgedBy: input.acknowledgedBy ?? null,
        resolvedBy: input.resolvedBy ?? null,
        ...input,
      } as SecurityIncidentEntity;
      this.data.incidents.push(incident);
      return incident;
    },
    listIncidents: async (query) => {
      const items = this.data.incidents
        .filter((i) => !query?.guildId || i.guildId === query.guildId)
        .filter((i) => !query?.status || i.status === query.status)
        .filter((i) => !query?.severity || i.severity === query.severity)
        .sort(byNewest);
      return page(items, query);
    },
    getIncident: async (id) => this.data.incidents.find((i) => i.id === id) ?? null,
    updateIncident: async (id, patch) => {
      const incident = this.data.incidents.find((i) => i.id === id);
      if (incident) Object.assign(incident, patch, { updatedAt: new Date() });
    },
  };

  audit: P.AuditRepository = {
    log: async (input) => {
      const entry: AuditLogEntity = { id: uuid(), createdAt: new Date(), ...input };
      this.data.audit.push(entry);
      if (this.data.audit.length > 20_000) this.data.audit.shift();
      return entry;
    },
    list: async (query) => {
      const items = this.data.audit
        .filter((a) => !query?.guildId || a.guildId === query.guildId)
        .filter((a) => !query?.actorId || a.actorId === query.actorId)
        .filter((a) => !query?.action || a.action.startsWith(query.action))
        .sort(byNewest);
      return page(items, query);
    },
  };

  // ========================================================= Tickets
  tickets: P.TicketRepository = {
    create: async (input) => {
      const number = (this.data.ticketSequence.get(input.guildId) ?? 0) + 1;
      this.data.ticketSequence.set(input.guildId, number);
      const ticket: TicketEntity = {
        id: uuid(),
        guildId: input.guildId,
        panelId: input.panelId ?? null,
        number,
        channelId: input.channelId,
        openerId: input.openerId,
        category: input.category,
        subject: input.subject ?? null,
        status: 'OPEN',
        claimedById: null,
        closedById: null,
        closedAt: null,
        closeReason: null,
        reopenCount: 0,
        rating: null,
        formData: input.formData ?? {},
        transcriptUrl: null,
        createdAt: new Date(),
      };
      this.data.tickets.push(ticket);
      return ticket;
    },
    findByChannel: async (channelId) => this.data.tickets.find((t) => t.channelId === channelId) ?? null,
    findByNumber: async (guildId, number) =>
      this.data.tickets.find((t) => t.guildId === guildId && t.number === number) ?? null,
    list: async (guildId, query) => {
      const items = this.data.tickets
        .filter((t) => t.guildId === guildId)
        .filter((t) => !query?.status || t.status === query.status)
        .filter((t) => !query?.openerId || t.openerId === query.openerId)
        .sort(byNewest);
      return page(items, query);
    },
    update: async (id, patch) => {
      const index = this.data.tickets.findIndex((t) => t.id === id);
      if (index < 0) throw new NotFoundError('Ticket');
      const updated = { ...this.data.tickets[index]!, ...patch };
      this.data.tickets[index] = updated;
      return updated;
    },
    addMessage: async (input) => {
      this.data.ticketMessages.push({ id: uuid(), createdAt: new Date(), ...input });
    },
    listMessages: async (ticketId) =>
      this.data.ticketMessages
        .filter((m) => m.ticketId === ticketId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    countOpenByUser: async (guildId, userId) =>
      this.data.tickets.filter(
        (t) =>
          t.guildId === guildId && t.openerId === userId && ['OPEN', 'CLAIMED', 'LOCKED'].includes(t.status),
      ).length,
  };

  // ========================================================== Levels
  levels: P.LevelRepository = {
    getProfile: async (guildId, userId) => {
      const key = this.key(guildId, userId);
      let profile = this.data.xp.get(key);
      if (!profile) {
        profile = emptyXpProfile(guildId, userId);
        this.data.xp.set(key, profile);
      }
      return profile;
    },
    addXp: async (guildId, userId, amount) => {
      const key = this.key(guildId, userId);
      const current = this.data.xp.get(key) ?? emptyXpProfile(guildId, userId);
      const previousLevel = current.level;
      const totalXp = Math.max(0, current.totalXp + amount);
      const { level, xpIntoLevel } = levelFromTotalXp(totalXp);
      const profile: XPProfileEntity = {
        ...current,
        totalXp,
        xp: xpIntoLevel,
        level,
        messages: amount > 0 ? current.messages + 1 : current.messages,
        lastXpAt: new Date(),
      };
      this.data.xp.set(key, profile);
      return { profile, leveledUp: level > previousLevel, previousLevel };
    },
    setLevel: async (guildId, userId, level) => {
      const key = this.key(guildId, userId);
      const current = this.data.xp.get(key) ?? emptyXpProfile(guildId, userId);
      let totalXp = 0;
      for (let index = 0; index < level; index++) totalXp += 5 * index * index + 50 * index + 100;
      const profile: XPProfileEntity = { ...current, level, xp: 0, totalXp };
      this.data.xp.set(key, profile);
      return profile;
    },
    leaderboard: async (guildId, limit = 10, offset = 0) =>
      [...this.data.xp.values()]
        .filter((p) => p.guildId === guildId)
        .sort((a, b) => b.totalXp - a.totalXp)
        .map((profile, index) => ({ ...profile, rank: index + 1 }))
        .slice(offset, offset + limit),
    rankOf: async (guildId, userId) => {
      const sorted = [...this.data.xp.values()]
        .filter((p) => p.guildId === guildId)
        .sort((a, b) => b.totalXp - a.totalXp);
      const index = sorted.findIndex((p) => p.userId === userId);
      return index < 0 ? sorted.length + 1 : index + 1;
    },
    listRewards: async (guildId) => this.data.levelRewards.get(guildId) ?? [],
  };

  // ========================================================= Economy
  private economyProfile(guildId: string, userId: string): EconomyProfileEntity {
    const key = this.key(guildId, userId);
    let profile = this.data.economy.get(key);
    if (!profile) {
      profile = {
        id: uuid(),
        guildId,
        userId,
        wallet: 0,
        bank: 0,
        bankCapacity: 10_000,
        version: 0,
        totalEarned: 0,
        totalSpent: 0,
        streakDays: 0,
        lastDailyAt: null,
        lastWeeklyAt: null,
        lastWorkAt: null,
        lastCrimeAt: null,
        lastRobAt: null,
      };
      this.data.economy.set(key, profile);
    }
    return profile;
  }

  economy: P.EconomyRepository = {
    getProfile: async (guildId, userId) => this.economyProfile(guildId, userId),
    mutate: async (mutation) => {
      // Idempotenz zuerst pruefen: doppelte Aufrufe duerfen nicht doppelt buchen.
      if (mutation.idempotencyKey && this.data.idempotency.has(mutation.idempotencyKey)) {
        return { profile: this.economyProfile(mutation.guildId, mutation.userId), transaction: null };
      }
      const profile = this.economyProfile(mutation.guildId, mutation.userId);
      const field = mutation.target;
      const next = profile[field] + mutation.amount;
      if (next < 0 && !mutation.allowNegative) {
        throw new PreconditionError('Nicht genuegend Guthaben', {
          required: Math.abs(mutation.amount),
          available: profile[field],
        });
      }
      if (field === 'bank' && next > profile.bankCapacity) {
        throw new PreconditionError('Bank-Kapazitaet ueberschritten', { capacity: profile.bankCapacity });
      }
      const updated: EconomyProfileEntity = {
        ...profile,
        [field]: next,
        version: profile.version + 1,
        totalEarned: mutation.amount > 0 ? profile.totalEarned + mutation.amount : profile.totalEarned,
        totalSpent: mutation.amount < 0 ? profile.totalSpent - mutation.amount : profile.totalSpent,
      };
      this.data.economy.set(this.key(mutation.guildId, mutation.userId), updated);
      if (mutation.idempotencyKey) this.data.idempotency.add(mutation.idempotencyKey);
      const transaction: TransactionEntity = {
        id: uuid(),
        guildId: mutation.guildId,
        userId: mutation.userId,
        type: mutation.type,
        amount: mutation.amount,
        balanceAfter: updated.wallet + updated.bank,
        counterpartyId: mutation.counterpartyId ?? null,
        reason: mutation.reason ?? null,
        idempotencyKey: mutation.idempotencyKey ?? null,
        createdAt: new Date(),
      };
      this.data.transactions.push(transaction);
      return { profile: updated, transaction };
    },
    transfer: async ({ guildId, fromUserId, toUserId, amount, reason, idempotencyKey }) => {
      if (amount <= 0) throw new PreconditionError('Betrag muss positiv sein');
      if (fromUserId === toUserId) throw new PreconditionError('Selbsttransfer ist nicht moeglich');
      if (idempotencyKey && this.data.idempotency.has(idempotencyKey)) {
        return { from: this.economyProfile(guildId, fromUserId), to: this.economyProfile(guildId, toUserId) };
      }
      const from = this.economyProfile(guildId, fromUserId);
      if (from.wallet < amount) {
        throw new PreconditionError('Nicht genuegend Guthaben', { required: amount, available: from.wallet });
      }
      // Beide Seiten werden ohne dazwischenliegenden await-Punkt aktualisiert.
      const to = this.economyProfile(guildId, toUserId);
      const updatedFrom = {
        ...from,
        wallet: from.wallet - amount,
        totalSpent: from.totalSpent + amount,
        version: from.version + 1,
      };
      const updatedTo = {
        ...to,
        wallet: to.wallet + amount,
        totalEarned: to.totalEarned + amount,
        version: to.version + 1,
      };
      this.data.economy.set(this.key(guildId, fromUserId), updatedFrom);
      this.data.economy.set(this.key(guildId, toUserId), updatedTo);
      if (idempotencyKey) this.data.idempotency.add(idempotencyKey);
      const now = new Date();
      this.data.transactions.push(
        {
          id: uuid(),
          guildId,
          userId: fromUserId,
          type: 'TRANSFER_OUT',
          amount: -amount,
          balanceAfter: updatedFrom.wallet + updatedFrom.bank,
          counterpartyId: toUserId,
          reason: reason ?? null,
          idempotencyKey: idempotencyKey ?? null,
          createdAt: now,
        },
        {
          id: uuid(),
          guildId,
          userId: toUserId,
          type: 'TRANSFER_IN',
          amount,
          balanceAfter: updatedTo.wallet + updatedTo.bank,
          counterpartyId: fromUserId,
          reason: reason ?? null,
          idempotencyKey: null,
          createdAt: now,
        },
      );
      return { from: updatedFrom, to: updatedTo };
    },
    touchCooldown: async (guildId, userId, field, at, streakDays) => {
      const profile = this.economyProfile(guildId, userId);
      this.data.economy.set(this.key(guildId, userId), {
        ...profile,
        [field]: at,
        streakDays: streakDays ?? profile.streakDays,
      });
    },
    leaderboard: async (guildId, limit = 10) =>
      [...this.data.economy.values()]
        .filter((p) => p.guildId === guildId)
        .sort((a, b) => b.wallet + b.bank - (a.wallet + a.bank))
        .slice(0, limit)
        .map((profile, index) => ({ ...profile, rank: index + 1 })),
    listTransactions: async (guildId, userId, limit = 20) =>
      this.data.transactions
        .filter((t) => t.guildId === guildId && t.userId === userId)
        .sort(byNewest)
        .slice(0, limit),
    listItems: async (guildId, enabledOnly = true) =>
      this.data.items.filter((i) => i.guildId === guildId && (!enabledOnly || i.enabled)),
    getItem: async (guildId, key) =>
      this.data.items.find((i) => i.guildId === guildId && i.key === key) ?? null,
    upsertItem: async (item) => {
      const index = this.data.items.findIndex((i) => i.guildId === item.guildId && i.key === item.key);
      const entity: ItemEntity = { id: index >= 0 ? this.data.items[index]!.id : uuid(), ...item };
      if (index >= 0) this.data.items[index] = entity;
      else this.data.items.push(entity);
      return entity;
    },
    inventory: async (guildId, userId) => {
      const entries = this.data.inventory.get(this.key(guildId, userId)) ?? new Map<string, number>();
      const result: InventoryEntryEntity[] = [];
      for (const [itemId, quantity] of entries) {
        const item = this.data.items.find((i) => i.id === itemId);
        if (item && quantity > 0) {
          result.push({
            itemId,
            itemKey: item.key,
            name: item.name,
            emoji: item.emoji,
            quantity,
            tradable: item.tradable,
          });
        }
      }
      return result;
    },
    addInventory: async (guildId, userId, itemId, quantity) => {
      const key = this.key(guildId, userId);
      const entries = this.data.inventory.get(key) ?? new Map<string, number>();
      const next = (entries.get(itemId) ?? 0) + quantity;
      if (next < 0) throw new PreconditionError('Nicht genuegend Exemplare im Inventar');
      entries.set(itemId, next);
      this.data.inventory.set(key, entries);
    },
  };

  // ==================================================== Verification
  verification: P.VerificationRepository = {
    create: async (input) => {
      const entity: VerificationEntity = {
        id: uuid(),
        userId: input.userId,
        discordId: input.discordId,
        codeHash: input.codeHash,
        codeHint: input.codeHint,
        guildId: input.guildId ?? null,
        gameId: input.gameId ?? null,
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 5,
        robloxUserId: null,
        expiresAt: input.expiresAt,
        createdAt: new Date(),
      };
      this.data.verifications.push(entity);
      return entity;
    },
    findActiveByHint: async (codeHint) =>
      this.data.verifications.filter(
        (v) => v.codeHint === codeHint && v.status === 'PENDING' && v.expiresAt > new Date(),
      ),
    incrementAttempts: async (id) => {
      const entity = this.data.verifications.find((v) => v.id === id);
      if (!entity) return 0;
      entity.attempts += 1;
      if (entity.attempts >= entity.maxAttempts) entity.status = 'REVOKED';
      return entity.attempts;
    },
    markVerified: async (id, robloxUserId) => {
      const entity = this.data.verifications.find((v) => v.id === id);
      if (entity) {
        entity.status = 'VERIFIED';
        entity.robloxUserId = robloxUserId;
      }
    },
    invalidateForUser: async (userId) => {
      for (const entity of this.data.verifications) {
        if (entity.userId === userId && entity.status === 'PENDING') entity.status = 'REVOKED';
      }
    },
    purgeExpired: async (now) => {
      let count = 0;
      for (const entity of this.data.verifications) {
        if (entity.status === 'PENDING' && entity.expiresAt <= now) {
          entity.status = 'EXPIRED';
          count++;
        }
      }
      return count;
    },
  };

  // ========================================================== Roblox
  roblox: P.RobloxRepository = {
    linkAccount: async (input) => {
      const existingByRoblox = [...this.data.robloxAccounts.values()].find(
        (a) => a.robloxUserId === input.robloxUserId && a.userId !== input.userId,
      );
      if (existingByRoblox) {
        throw new ConflictError(
          'Dieser Roblox-Account ist bereits mit einem anderen Discord-Konto verknuepft',
        );
      }
      const previous = this.data.robloxAccounts.get(input.userId);
      const account: RobloxAccountEntity = {
        id: previous?.id ?? uuid(),
        userId: input.userId,
        discordId: input.discordId,
        robloxUserId: input.robloxUserId,
        username: input.username,
        displayName: input.displayName ?? null,
        avatarUrl: input.avatarUrl ?? null,
        previousUsername:
          previous && previous.username !== input.username
            ? previous.username
            : (previous?.previousUsername ?? null),
        verifiedAt: previous?.verifiedAt ?? new Date(),
        method: input.method ?? 'game',
        lastSyncedAt: new Date(),
      };
      this.data.robloxAccounts.set(input.userId, account);
      return account;
    },
    unlinkAccount: async (userId) => this.data.robloxAccounts.delete(userId),
    getAccountByUser: async (userId) => this.data.robloxAccounts.get(userId) ?? null,
    getAccountByDiscordId: async (discordId) =>
      [...this.data.robloxAccounts.values()].find((a) => a.discordId === discordId) ?? null,
    getAccountByRobloxId: async (robloxUserId) =>
      [...this.data.robloxAccounts.values()].find((a) => a.robloxUserId === robloxUserId) ?? null,
    updateAccountNames: async (id, username, displayName) => {
      for (const [key, account] of this.data.robloxAccounts) {
        if (account.id === id) {
          this.data.robloxAccounts.set(key, {
            ...account,
            previousUsername: account.username !== username ? account.username : account.previousUsername,
            username,
            displayName,
            lastSyncedAt: new Date(),
          });
        }
      }
    },
    upsertGame: async (input) => {
      const index = this.data.games.findIndex(
        (g) => g.guildId === input.guildId && g.universeId === input.universeId,
      );
      const game: RobloxGameEntity = {
        id: index >= 0 ? this.data.games[index]!.id : uuid(),
        lastEventAt: index >= 0 ? this.data.games[index]!.lastEventAt : null,
        ...input,
      };
      if (index >= 0) this.data.games[index] = game;
      else this.data.games.push(game);
      return game;
    },
    listGames: async (guildId) => this.data.games.filter((g) => !guildId || g.guildId === guildId),
    getGame: async (id) => this.data.games.find((g) => g.id === id) ?? null,
    getGameByUniverse: async (universeId) => this.data.games.find((g) => g.universeId === universeId) ?? null,
    recordHeartbeat: async (input) => {
      const index = this.data.servers.findIndex((s) => s.gameId === input.gameId && s.jobId === input.jobId);
      const server: RobloxServerEntity = {
        id: index >= 0 ? this.data.servers[index]!.id : uuid(),
        startedAt: input.startedAt ?? this.data.servers[index]?.startedAt ?? new Date(),
        status: 'online',
        ...input,
      };
      if (index >= 0) this.data.servers[index] = server;
      else this.data.servers.push(server);
      return server;
    },
    listServers: async (gameId) => this.data.servers.filter((s) => !gameId || s.gameId === gameId),
    markStaleServers: async (threshold) => {
      let count = 0;
      for (const server of this.data.servers) {
        if (server.status === 'online' && server.lastHeartbeatAt < threshold) {
          server.status = 'stale';
          count++;
        }
      }
      return count;
    },
    recordEvent: async (input) => {
      const existing = this.data.events.find((e) => e.eventId === input.eventId);
      if (existing) return { event: existing, duplicate: true };
      const event: RobloxEventEntity = {
        id: uuid(),
        receivedAt: new Date(),
        processedAt: null,
        error: null,
        ...input,
      };
      this.data.events.push(event);
      const game = this.data.games.find((g) => g.id === input.gameId);
      if (game) game.lastEventAt = new Date();
      return { event, duplicate: false };
    },
    markEventProcessed: async (id, error) => {
      const event = this.data.events.find((e) => e.id === id);
      if (event) {
        event.processedAt = new Date();
        event.error = error ?? null;
      }
    },
    listEvents: async (query) => {
      const items = this.data.events
        .filter((e) => !query.gameId || e.gameId === query.gameId)
        .filter((e) => !query.type || e.type === query.type)
        .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
      return page(items, query);
    },
    listEventRoutes: async (guildId, eventType) =>
      this.data.eventRoutes
        .filter((r) => r.guildId === guildId && r.eventType === eventType && r.enabled)
        .map((r) => ({ channelId: r.channelId, gameId: r.gameId, filter: r.filter })),
    upsertEventRoute: async (input) => {
      const index = this.data.eventRoutes.findIndex(
        (r) =>
          r.guildId === input.guildId &&
          r.gameId === input.gameId &&
          r.eventType === input.eventType &&
          r.channelId === input.channelId,
      );
      const route = { ...input, filter: {} };
      if (index >= 0) this.data.eventRoutes[index] = route;
      else this.data.eventRoutes.push(route);
    },
    queueCommand: async (input) => {
      const command: RobloxCommandEntity = {
        id: uuid(),
        status: 'PENDING',
        deliveredAt: null,
        acknowledgedAt: null,
        result: null,
        error: null,
        createdAt: new Date(),
        ...input,
      };
      this.data.commands.push(command);
      return command;
    },
    claimCommands: async (gameId, jobId, limit = 10) => {
      const now = new Date();
      const claimed = this.data.commands
        .filter(
          (c) =>
            c.gameId === gameId &&
            c.status === 'PENDING' &&
            c.expiresAt > now &&
            (c.jobId === null || c.jobId === jobId),
        )
        .slice(0, limit);
      for (const command of claimed) {
        command.status = 'DELIVERED';
        command.deliveredAt = now;
      }
      return claimed;
    },
    acknowledgeCommand: async (id, result) => {
      const command = this.data.commands.find((c) => c.id === id);
      if (!command) return;
      command.status = result.ok ? 'ACKNOWLEDGED' : 'FAILED';
      command.acknowledgedAt = new Date();
      command.result = result.message ?? null;
      if (!result.ok) command.error = result.message ?? 'unbekannter Fehler';
    },
    expireCommands: async (now) => {
      let count = 0;
      for (const command of this.data.commands) {
        if (['PENDING', 'DELIVERED'].includes(command.status) && command.expiresAt <= now) {
          command.status = 'EXPIRED';
          count++;
        }
      }
      return count;
    },
    listGroups: async (guildId) => this.data.groups.filter((g) => g.guildId === guildId),
    upsertGroup: async (input) => {
      const index = this.data.groups.findIndex(
        (g) => g.guildId === input.guildId && g.groupId === input.groupId,
      );
      const group: RobloxGroupEntity = {
        id: index >= 0 ? this.data.groups[index]!.id : uuid(),
        lastSyncAt: index >= 0 ? this.data.groups[index]!.lastSyncAt : null,
        ...input,
      };
      if (index >= 0) this.data.groups[index] = group;
      else this.data.groups.push(group);
      return group;
    },
    setGroupSynced: async (id, at) => {
      const group = this.data.groups.find((g) => g.id === id);
      if (group) group.lastSyncAt = at;
    },
    startSession: async ({ gameId, robloxUserId, jobId }) => {
      this.data.sessions.push({ gameId, robloxUserId, jobId, joinedAt: new Date(), leftAt: null });
    },
    endSession: async (gameId, robloxUserId, at) => {
      const session = [...this.data.sessions]
        .reverse()
        .find((s) => s.gameId === gameId && s.robloxUserId === robloxUserId && s.leftAt === null);
      if (!session) return null;
      session.leftAt = at;
      return Math.round((at.getTime() - session.joinedAt.getTime()) / 1000);
    },
  };

  // ========================================================= Rewards
  rewards: P.RewardRepository = {
    grant: async (input) => {
      const existing = this.data.rewards.find((r) => r.idempotencyKey === input.idempotencyKey);
      if (existing) return { grant: existing, created: false };
      const grant: RewardGrantEntity = {
        id: uuid(),
        createdAt: new Date(),
        status: input.status ?? 'PENDING',
        ...input,
      };
      this.data.rewards.push(grant);
      return { grant, created: true };
    },
    markGranted: async (id, error) => {
      const grant = this.data.rewards.find((r) => r.id === id);
      if (grant) grant.status = error ? 'FAILED' : 'GRANTED';
    },
    listForUser: async (userId, limit = 25) =>
      this.data.rewards
        .filter((r) => r.userId === userId)
        .sort(byNewest)
        .slice(0, limit),
  };

  achievements: P.AchievementRepository = {
    list: async (guildId) => this.data.achievements.filter((a) => a.guildId === guildId),
    get: async (guildId, key) =>
      this.data.achievements.find((a) => a.guildId === guildId && a.key === key) ?? null,
    upsert: async (input) => {
      const index = this.data.achievements.findIndex(
        (a) => a.guildId === input.guildId && a.key === input.key,
      );
      const entity: AchievementEntity = {
        id: index >= 0 ? this.data.achievements[index]!.id : uuid(),
        ...input,
      };
      if (index >= 0) this.data.achievements[index] = entity;
      else this.data.achievements.push(entity);
      return entity;
    },
    unlock: async (achievementId, userId, guildId) => {
      if (this.data.unlocks.some((u) => u.achievementId === achievementId && u.userId === userId))
        return false;
      this.data.unlocks.push({ achievementId, userId, guildId, unlockedAt: new Date() });
      return true;
    },
    listUnlocked: async (userId, guildId) =>
      this.data.unlocks
        .filter((u) => u.userId === userId && u.guildId === guildId)
        .map((u) => u.achievementId),
  };

  promos: P.PromoRepository = {
    create: async (input) => {
      const code: PromoCodeEntity = { id: uuid(), uses: 0, createdAt: new Date(), ...input };
      this.data.promos.push(code);
      return code;
    },
    list: async (guildId) => this.data.promos.filter((p) => p.guildId === guildId),
    findByCode: async (guildId, code) =>
      this.data.promos.find((p) => p.guildId === guildId && p.code.toUpperCase() === code.toUpperCase()) ??
      null,
    delete: async (guildId, code) => {
      const index = this.data.promos.findIndex(
        (p) => p.guildId === guildId && p.code.toUpperCase() === code.toUpperCase(),
      );
      if (index < 0) return false;
      this.data.promos.splice(index, 1);
      return true;
    },
    redeem: async (codeId, userId) => {
      const promo = this.data.promos.find((p) => p.id === codeId);
      if (!promo || !promo.enabled) return { ok: false, reason: 'DISABLED' };
      if (promo.expiresAt && promo.expiresAt <= new Date()) return { ok: false, reason: 'EXPIRED' };
      if (promo.maxUses >= 0 && promo.uses >= promo.maxUses) return { ok: false, reason: 'EXHAUSTED' };
      const userUses = this.data.redemptions.filter((r) => r.codeId === codeId && r.userId === userId).length;
      if (userUses >= promo.perUserLimit) return { ok: false, reason: 'USER_LIMIT' };
      promo.uses += 1;
      this.data.redemptions.push({ codeId, userId });
      return { ok: true };
    },
  };

  giveaways: P.GiveawayRepository = {
    create: async (input) => {
      const giveaway: GiveawayEntity = {
        id: uuid(),
        ended: false,
        entries: [],
        winners: [],
        rerollCount: 0,
        createdAt: new Date(),
        ...input,
      };
      this.data.giveaways.push(giveaway);
      return giveaway;
    },
    get: async (id) => this.data.giveaways.find((g) => g.id === id) ?? null,
    findByMessage: async (messageId) => this.data.giveaways.find((g) => g.messageId === messageId) ?? null,
    list: async (guildId, endedOnly) =>
      this.data.giveaways.filter(
        (g) => g.guildId === guildId && (endedOnly === undefined || g.ended === endedOnly),
      ),
    addEntry: async (id, userId) => {
      const giveaway = this.data.giveaways.find((g) => g.id === id);
      if (!giveaway) throw new NotFoundError('Giveaway');
      if (giveaway.entries.includes(userId)) return { added: false, total: giveaway.entries.length };
      giveaway.entries.push(userId);
      return { added: true, total: giveaway.entries.length };
    },
    removeEntry: async (id, userId) => {
      const giveaway = this.data.giveaways.find((g) => g.id === id);
      if (giveaway) giveaway.entries = giveaway.entries.filter((entry) => entry !== userId);
    },
    setMessage: async (id, messageId) => {
      const giveaway = this.data.giveaways.find((g) => g.id === id);
      if (giveaway) giveaway.messageId = messageId;
    },
    finish: async (id, winners) => {
      const giveaway = this.data.giveaways.find((g) => g.id === id);
      if (!giveaway) throw new NotFoundError('Giveaway');
      giveaway.ended = true;
      giveaway.winners = winners;
      if (giveaway.winners.length > 0) giveaway.rerollCount += 0;
      return giveaway;
    },
    listDue: async (now) => this.data.giveaways.filter((g) => !g.ended && g.endsAt <= now),
  };

  automations: P.AutomationRepository = {
    list: async (guildId, trigger) =>
      this.data.automations.filter((a) => a.guildId === guildId && (!trigger || a.trigger === trigger)),
    get: async (id) => this.data.automations.find((a) => a.id === id) ?? null,
    create: async (input) => {
      const automation: AutomationEntity = {
        id: uuid(),
        runCount: 0,
        errorCount: 0,
        lastRunAt: null,
        lastError: null,
        ...input,
      };
      this.data.automations.push(automation);
      return automation;
    },
    update: async (id, patch) => {
      const automation = this.data.automations.find((a) => a.id === id);
      if (automation) Object.assign(automation, patch);
    },
    delete: async (id) => {
      const index = this.data.automations.findIndex((a) => a.id === id);
      if (index < 0) return false;
      this.data.automations.splice(index, 1);
      return true;
    },
    recordRun: async (id, status) => {
      const automation = this.data.automations.find((a) => a.id === id);
      if (!automation) return;
      automation.runCount += 1;
      automation.lastRunAt = new Date();
      if (status === 'FAILED') automation.errorCount += 1;
    },
  };

  backups: P.BackupRepository = {
    create: async (input) => {
      const serialized = JSON.stringify(input.payload);
      const entity: BackupEntity & { payload: unknown } = {
        id: uuid(),
        guildId: input.guildId,
        name: input.name,
        createdById: input.createdById,
        summary: input.summary,
        sizeBytes: Buffer.byteLength(serialized, 'utf8'),
        checksum: String(serialized.length),
        restoredAt: null,
        createdAt: new Date(),
        payload: input.payload,
      };
      this.data.backups.push(entity);
      return entity;
    },
    list: async (guildId) => this.data.backups.filter((b) => b.guildId === guildId).sort(byNewest),
    get: async (guildId, id) => this.data.backups.find((b) => b.guildId === guildId && b.id === id) ?? null,
    delete: async (guildId, id) => {
      const index = this.data.backups.findIndex((b) => b.guildId === guildId && b.id === id);
      if (index < 0) return false;
      this.data.backups.splice(index, 1);
      return true;
    },
    markRestored: async (id) => {
      const backup = this.data.backups.find((b) => b.id === id);
      if (backup) backup.restoredAt = new Date();
    },
    count: async (guildId) => this.data.backups.filter((b) => b.guildId === guildId).length,
  };

  apiKeys: P.ApiKeyRepository = {
    create: async (input) => {
      const key: ApiKeyEntity = {
        id: uuid(),
        createdAt: new Date(),
        lastUsedAt: null,
        usageCount: 0,
        revokedAt: null,
        ...input,
      };
      this.data.apiKeys.push(key);
      return key;
    },
    findByHash: async (hash) => this.data.apiKeys.find((k) => k.keyHash === hash && !k.revokedAt) ?? null,
    list: async (guildId) => this.data.apiKeys.filter((k) => k.guildId === guildId),
    revoke: async (id) => {
      const key = this.data.apiKeys.find((k) => k.id === id);
      if (key) key.revokedAt = new Date();
    },
    recordUsage: async (id, entry) => {
      const key = this.data.apiKeys.find((k) => k.id === id);
      if (key) {
        key.usageCount += 1;
        key.lastUsedAt = new Date();
      }
      this.data.apiRequests.push({ apiKeyId: id, createdAt: new Date(), ...entry });
      if (this.data.apiRequests.length > 5_000) this.data.apiRequests.shift();
    },
    listRequests: async (apiKeyId, limit = 50) =>
      this.data.apiRequests
        .filter((r) => r.apiKeyId === apiKeyId)
        .sort(byNewest)
        .slice(0, limit),
  };

  notifications: P.NotificationRepository = {
    create: async (input) => {
      const notification: NotificationEntity = { id: uuid(), read: false, createdAt: new Date(), ...input };
      this.data.notifications.push(notification);
      if (this.data.notifications.length > 5_000) this.data.notifications.shift();
      return notification;
    },
    list: async ({ guildId, userId, unreadOnly, limit = 50 }) =>
      this.data.notifications
        .filter(
          (n) =>
            (!guildId || n.guildId === guildId) &&
            (!userId || n.userId === userId) &&
            (!unreadOnly || !n.read),
        )
        .sort(byNewest)
        .slice(0, limit),
    markRead: async (id) => {
      const notification = this.data.notifications.find((n) => n.id === id);
      if (notification) notification.read = true;
    },
  };

  analytics: P.AnalyticsRepository = {
    record: async (snapshot) => {
      const index = this.data.analytics.findIndex(
        (s) =>
          s.guildId === snapshot.guildId &&
          s.scope === snapshot.scope &&
          s.granularity === snapshot.granularity &&
          s.bucket.getTime() === snapshot.bucket.getTime(),
      );
      if (index >= 0) this.data.analytics[index] = snapshot;
      else this.data.analytics.push(snapshot);
    },
    query: async (guildId, scope, from, to, granularity = 'day') =>
      this.data.analytics
        .filter(
          (s) =>
            s.guildId === guildId &&
            s.scope === scope &&
            s.granularity === granularity &&
            s.bucket >= from &&
            s.bucket <= to,
        )
        .sort((a, b) => a.bucket.getTime() - b.bucket.getTime()),
    summary: async (guildId) => {
      const guild = [...this.data.guilds.values()].find((g) => g.discordId === guildId);
      const openTickets = this.data.tickets.filter(
        (t) => t.guildId === guildId && t.status !== 'CLOSED' && t.status !== 'DELETED',
      ).length;
      const openIncidents = this.data.incidents.filter(
        (i) => i.guildId === guildId && i.status === 'OPEN',
      ).length;
      return {
        members: guild?.memberCount ?? 0,
        cases: this.data.cases.filter((c) => c.guildId === guildId).length,
        openTickets,
        openIncidents,
        verifiedMembers: [...this.data.robloxAccounts.values()].length,
        robloxServers: this.data.servers.filter((s) => s.status === 'online').length,
      };
    },
  };
}
