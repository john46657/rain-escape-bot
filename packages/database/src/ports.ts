/**
 * Repository-Ports (Schnittstellen der Persistenzschicht).
 *
 * Module und Services programmieren ausschliesslich gegen diese Ports.
 * Implementierungen: `prisma/` (Produktion) und `memory/` (Tests + Dev-Modus).
 */
import type {
  AchievementEntity,
  ApiKeyEntity,
  AnalyticsSnapshotEntity,
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
} from './entities.js';
import type {
  IncidentSeverity,
  IncidentStatus,
  Locale,
  ModerationAction,
  PremiumTier,
  TicketCategory,
  TicketStatus,
  TransactionType,
} from '@nexus/shared';

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PageQuery {
  page?: number;
  pageSize?: number;
}

export interface UserRepository {
  upsertFromDiscord(input: {
    discordId: string;
    username: string;
    globalName?: string | null;
    avatar?: string | null;
  }): Promise<UserEntity>;
  findByDiscordId(discordId: string): Promise<UserEntity | null>;
  setLocale(discordId: string, locale: Locale): Promise<void>;
  setBlacklist(discordId: string, blacklisted: boolean, note?: string): Promise<void>;
}

export interface GuildRepository {
  upsert(input: {
    discordId: string;
    name: string;
    icon?: string | null;
    ownerId: string;
    memberCount?: number;
  }): Promise<GuildEntity>;
  findByDiscordId(discordId: string): Promise<GuildEntity | null>;
  list(query?: PageQuery & { active?: boolean }): Promise<Page<GuildEntity>>;
  markInactive(discordId: string): Promise<void>;
  setPremium(discordId: string, tier: PremiumTier, until?: Date | null): Promise<void>;
  getConfig(guildId: string): Promise<GuildConfigEntity>;
  updateConfig(guildId: string, patch: Partial<GuildConfigEntity>): Promise<GuildConfigEntity>;
  listPermissionGrants(guildId: string): Promise<PermissionGrantEntity[]>;
  upsertPermissionGrant(input: Omit<PermissionGrantEntity, 'id'>): Promise<PermissionGrantEntity>;
}

export interface CreateModerationCaseInput {
  guildId: string;
  action: ModerationAction;
  targetId: string;
  targetTag?: string | null;
  moderatorId: string;
  moderatorTag?: string | null;
  reason?: string;
  source?: ModerationCaseEntity['source'];
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  durationMs?: number | null;
  expiresAt?: Date | null;
}

export interface ModerationRepository {
  /** Erzeugt einen Fall mit atomar vergebener, lueckenloser Fallnummer. */
  createCase(input: CreateModerationCaseInput): Promise<ModerationCaseEntity>;
  getCase(guildId: string, caseId: string): Promise<ModerationCaseEntity | null>;
  listCases(
    guildId: string,
    query?: PageQuery & {
      targetId?: string;
      moderatorId?: string;
      action?: ModerationAction;
    },
  ): Promise<Page<ModerationCaseEntity>>;
  updateCase(
    id: string,
    patch: Partial<
      Pick<
        ModerationCaseEntity,
        'reason' | 'active' | 'revoked' | 'revokedById' | 'revokedAt' | 'logMessageId'
      >
    >,
  ): Promise<void>;
  /** Faelle, deren Befristung abgelaufen ist (Timeout/Tempban-Aufhebung). */
  listExpiredCases(now: Date, limit?: number): Promise<ModerationCaseEntity[]>;

  addWarning(input: {
    guildId: string;
    targetId: string;
    moderatorId: string;
    reason: string;
    points?: number;
    caseRef?: string | null;
    expiresAt?: Date | null;
  }): Promise<WarningEntity>;
  listWarnings(guildId: string, targetId: string, activeOnly?: boolean): Promise<WarningEntity[]>;
  deactivateWarning(id: string): Promise<boolean>;
  expireWarnings(now: Date): Promise<number>;
}

export interface SecurityRepository {
  createIncident(
    input: Omit<SecurityIncidentEntity, 'id' | 'createdAt' | 'updatedAt' | 'acknowledgedBy' | 'resolvedBy'> &
      Partial<Pick<SecurityIncidentEntity, 'acknowledgedBy' | 'resolvedBy'>>,
  ): Promise<SecurityIncidentEntity>;
  listIncidents(
    query?: PageQuery & {
      guildId?: string;
      status?: IncidentStatus;
      severity?: IncidentSeverity;
    },
  ): Promise<Page<SecurityIncidentEntity>>;
  getIncident(id: string): Promise<SecurityIncidentEntity | null>;
  updateIncident(
    id: string,
    patch: Partial<
      Pick<SecurityIncidentEntity, 'status' | 'severity' | 'acknowledgedBy' | 'resolvedBy' | 'actionsTaken'>
    >,
  ): Promise<void>;
}

export interface AuditRepository {
  log(input: Omit<AuditLogEntity, 'id' | 'createdAt'>): Promise<AuditLogEntity>;
  list(
    query?: PageQuery & { guildId?: string; actorId?: string; action?: string },
  ): Promise<Page<AuditLogEntity>>;
}

export interface TicketRepository {
  create(input: {
    guildId: string;
    panelId?: string | null;
    channelId: string;
    openerId: string;
    category: TicketCategory;
    subject?: string | null;
    formData?: Record<string, unknown>;
  }): Promise<TicketEntity>;
  findByChannel(channelId: string): Promise<TicketEntity | null>;
  findByNumber(guildId: string, number: number): Promise<TicketEntity | null>;
  list(
    guildId: string,
    query?: PageQuery & { status?: TicketStatus; openerId?: string },
  ): Promise<Page<TicketEntity>>;
  update(id: string, patch: Partial<TicketEntity>): Promise<TicketEntity>;
  addMessage(input: Omit<TicketMessageEntity, 'id' | 'createdAt'>): Promise<void>;
  listMessages(ticketId: string): Promise<TicketMessageEntity[]>;
  countOpenByUser(guildId: string, userId: string): Promise<number>;
}

export interface LevelRepository {
  getProfile(guildId: string, userId: string): Promise<XPProfileEntity>;
  /** Atomar; gibt das neue Profil und die Information ueber ein Level-Up zurueck. */
  addXp(
    guildId: string,
    userId: string,
    amount: number,
  ): Promise<{ profile: XPProfileEntity; leveledUp: boolean; previousLevel: number }>;
  setLevel(guildId: string, userId: string, level: number): Promise<XPProfileEntity>;
  leaderboard(
    guildId: string,
    limit?: number,
    offset?: number,
  ): Promise<Array<XPProfileEntity & { rank: number }>>;
  rankOf(guildId: string, userId: string): Promise<number>;
  listRewards(
    guildId: string,
  ): Promise<Array<{ level: number; roleId: string | null; coins: number; removePrevious: boolean }>>;
}

export interface EconomyMutation {
  guildId: string;
  userId: string;
  type: TransactionType;
  /** Positiv = Gutschrift, negativ = Belastung. */
  amount: number;
  target: 'wallet' | 'bank';
  reason?: string;
  counterpartyId?: string;
  /** Verhindert doppelte Buchungen bei Retries (Regel 25). */
  idempotencyKey?: string;
  /** Erlaubt negatives Guthaben (z. B. Strafen). Standard: nein. */
  allowNegative?: boolean;
}

export interface EconomyRepository {
  getProfile(guildId: string, userId: string): Promise<EconomyProfileEntity>;
  /**
   * Fuehrt eine Buchung atomar durch: Saldo pruefen, aktualisieren und
   * Journal schreiben in einer Transaktion. Wirft bei Unterdeckung.
   */
  mutate(
    mutation: EconomyMutation,
  ): Promise<{ profile: EconomyProfileEntity; transaction: TransactionEntity | null }>;
  /** Atomarer Transfer zwischen zwei Nutzern (beide Seiten oder keine). */
  transfer(input: {
    guildId: string;
    fromUserId: string;
    toUserId: string;
    amount: number;
    reason?: string;
    idempotencyKey?: string;
  }): Promise<{ from: EconomyProfileEntity; to: EconomyProfileEntity }>;
  touchCooldown(
    guildId: string,
    userId: string,
    field: 'lastDailyAt' | 'lastWeeklyAt' | 'lastWorkAt' | 'lastCrimeAt' | 'lastRobAt',
    at: Date,
    streakDays?: number,
  ): Promise<void>;
  leaderboard(guildId: string, limit?: number): Promise<Array<EconomyProfileEntity & { rank: number }>>;
  listTransactions(guildId: string, userId: string, limit?: number): Promise<TransactionEntity[]>;

  listItems(guildId: string, enabledOnly?: boolean): Promise<ItemEntity[]>;
  getItem(guildId: string, key: string): Promise<ItemEntity | null>;
  upsertItem(item: Omit<ItemEntity, 'id'>): Promise<ItemEntity>;
  inventory(guildId: string, userId: string): Promise<InventoryEntryEntity[]>;
  addInventory(guildId: string, userId: string, itemId: string, quantity: number): Promise<void>;
}

export interface VerificationRepository {
  create(input: {
    userId: string;
    discordId: string;
    codeHash: string;
    codeHint: string;
    guildId?: string | null;
    gameId?: string | null;
    expiresAt: Date;
  }): Promise<VerificationEntity>;
  findActiveByHint(codeHint: string): Promise<VerificationEntity[]>;
  incrementAttempts(id: string): Promise<number>;
  markVerified(id: string, robloxUserId: string): Promise<void>;
  invalidateForUser(userId: string): Promise<void>;
  purgeExpired(now: Date): Promise<number>;
}

export interface RobloxRepository {
  linkAccount(input: {
    userId: string;
    discordId: string;
    robloxUserId: string;
    username: string;
    displayName?: string | null;
    avatarUrl?: string | null;
    method?: 'game' | 'oauth' | 'manual';
  }): Promise<RobloxAccountEntity>;
  unlinkAccount(userId: string): Promise<boolean>;
  getAccountByUser(userId: string): Promise<RobloxAccountEntity | null>;
  getAccountByDiscordId(discordId: string): Promise<RobloxAccountEntity | null>;
  getAccountByRobloxId(robloxUserId: string): Promise<RobloxAccountEntity | null>;
  updateAccountNames(id: string, username: string, displayName: string | null): Promise<void>;

  upsertGame(input: Omit<RobloxGameEntity, 'id' | 'lastEventAt'>): Promise<RobloxGameEntity>;
  listGames(guildId?: string): Promise<RobloxGameEntity[]>;
  getGame(id: string): Promise<RobloxGameEntity | null>;
  getGameByUniverse(universeId: string): Promise<RobloxGameEntity | null>;

  recordHeartbeat(
    input: Omit<RobloxServerEntity, 'id' | 'startedAt' | 'status'> & { startedAt?: Date },
  ): Promise<RobloxServerEntity>;
  listServers(gameId?: string): Promise<RobloxServerEntity[]>;
  markStaleServers(threshold: Date): Promise<number>;

  /** Idempotent: ein bereits bekanntes `eventId` wird nicht erneut gespeichert. */
  recordEvent(
    input: Omit<RobloxEventEntity, 'id' | 'receivedAt' | 'processedAt' | 'error'>,
  ): Promise<{ event: RobloxEventEntity; duplicate: boolean }>;
  markEventProcessed(id: string, error?: string): Promise<void>;
  listEvents(query: PageQuery & { gameId?: string; type?: string }): Promise<Page<RobloxEventEntity>>;
  listEventRoutes(
    guildId: string,
    eventType: string,
  ): Promise<Array<{ channelId: string; gameId: string | null; filter: Record<string, unknown> }>>;
  upsertEventRoute(input: {
    guildId: string;
    gameId: string | null;
    eventType: string;
    channelId: string;
    enabled: boolean;
  }): Promise<void>;

  queueCommand(
    input: Omit<
      RobloxCommandEntity,
      'id' | 'status' | 'deliveredAt' | 'acknowledgedAt' | 'result' | 'error' | 'createdAt'
    >,
  ): Promise<RobloxCommandEntity>;
  /** Holt faellige Kommandos und markiert sie atomar als zugestellt. */
  claimCommands(gameId: string, jobId: string, limit?: number): Promise<RobloxCommandEntity[]>;
  acknowledgeCommand(id: string, result: { ok: boolean; message?: string }): Promise<void>;
  expireCommands(now: Date): Promise<number>;

  listGroups(guildId: string): Promise<RobloxGroupEntity[]>;
  upsertGroup(input: Omit<RobloxGroupEntity, 'id' | 'lastSyncAt'>): Promise<RobloxGroupEntity>;
  setGroupSynced(id: string, at: Date): Promise<void>;

  startSession(input: {
    gameId: string;
    robloxUserId: string;
    jobId: string | null;
    accountId?: string | null;
  }): Promise<void>;
  endSession(gameId: string, robloxUserId: string, at: Date): Promise<number | null>;
}

export interface RewardRepository {
  /** Idempotent (Regel 25): existiert der Key bereits, wird nichts erneut vergeben. */
  grant(
    input: Omit<RewardGrantEntity, 'id' | 'createdAt' | 'status'> & { status?: RewardGrantEntity['status'] },
  ): Promise<{ grant: RewardGrantEntity; created: boolean }>;
  markGranted(id: string, error?: string): Promise<void>;
  listForUser(userId: string, limit?: number): Promise<RewardGrantEntity[]>;
}

export interface AchievementRepository {
  list(guildId: string): Promise<AchievementEntity[]>;
  get(guildId: string, key: string): Promise<AchievementEntity | null>;
  upsert(input: Omit<AchievementEntity, 'id'>): Promise<AchievementEntity>;
  unlock(achievementId: string, userId: string, guildId: string): Promise<boolean>;
  listUnlocked(userId: string, guildId: string): Promise<string[]>;
}

export interface PromoRepository {
  create(input: Omit<PromoCodeEntity, 'id' | 'uses' | 'createdAt'>): Promise<PromoCodeEntity>;
  list(guildId: string): Promise<PromoCodeEntity[]>;
  findByCode(guildId: string, code: string): Promise<PromoCodeEntity | null>;
  delete(guildId: string, code: string): Promise<boolean>;
  /** Atomar: prueft Limits und registriert die Einloesung. */
  redeem(codeId: string, userId: string): Promise<{ ok: boolean; reason?: string }>;
}

export interface GiveawayRepository {
  create(
    input: Omit<GiveawayEntity, 'id' | 'createdAt' | 'ended' | 'entries' | 'winners' | 'rerollCount'>,
  ): Promise<GiveawayEntity>;
  get(id: string): Promise<GiveawayEntity | null>;
  findByMessage(messageId: string): Promise<GiveawayEntity | null>;
  list(guildId: string, endedOnly?: boolean): Promise<GiveawayEntity[]>;
  addEntry(id: string, userId: string): Promise<{ added: boolean; total: number }>;
  removeEntry(id: string, userId: string): Promise<void>;
  setMessage(id: string, messageId: string): Promise<void>;
  finish(id: string, winners: string[]): Promise<GiveawayEntity>;
  listDue(now: Date): Promise<GiveawayEntity[]>;
}

export interface AutomationRepository {
  list(guildId: string, trigger?: string): Promise<AutomationEntity[]>;
  get(id: string): Promise<AutomationEntity | null>;
  create(
    input: Omit<AutomationEntity, 'id' | 'runCount' | 'errorCount' | 'lastRunAt' | 'lastError'>,
  ): Promise<AutomationEntity>;
  update(id: string, patch: Partial<AutomationEntity>): Promise<void>;
  delete(id: string): Promise<boolean>;
  recordRun(
    id: string,
    status: 'SUCCESS' | 'SKIPPED' | 'FAILED',
    trace: Record<string, unknown>,
    durationMs: number,
  ): Promise<void>;
}

export interface BackupRepository {
  create(input: {
    guildId: string;
    name: string;
    createdById: string;
    payload: unknown;
    summary: Record<string, number>;
  }): Promise<BackupEntity>;
  list(guildId: string): Promise<BackupEntity[]>;
  get(guildId: string, id: string): Promise<(BackupEntity & { payload: unknown }) | null>;
  delete(guildId: string, id: string): Promise<boolean>;
  markRestored(id: string, userId: string): Promise<void>;
  count(guildId: string): Promise<number>;
}

export interface ApiKeyRepository {
  create(
    input: Omit<ApiKeyEntity, 'id' | 'createdAt' | 'lastUsedAt' | 'usageCount' | 'revokedAt'>,
  ): Promise<ApiKeyEntity>;
  findByHash(hash: string): Promise<ApiKeyEntity | null>;
  list(guildId: string): Promise<ApiKeyEntity[]>;
  revoke(id: string): Promise<void>;
  recordUsage(
    id: string,
    entry: {
      method: string;
      path: string;
      statusCode: number;
      durationMs: number;
      ip?: string;
      requestId?: string;
      error?: string;
    },
  ): Promise<void>;
  listRequests(
    apiKeyId: string,
    limit?: number,
  ): Promise<
    Array<{ method: string; path: string; statusCode: number; durationMs: number; createdAt: Date }>
  >;
}

export interface NotificationRepository {
  create(input: Omit<NotificationEntity, 'id' | 'createdAt' | 'read'>): Promise<NotificationEntity>;
  list(query: {
    guildId?: string;
    userId?: string;
    unreadOnly?: boolean;
    limit?: number;
  }): Promise<NotificationEntity[]>;
  markRead(id: string): Promise<void>;
}

export interface AnalyticsRepository {
  record(snapshot: AnalyticsSnapshotEntity): Promise<void>;
  query(
    guildId: string,
    scope: AnalyticsSnapshotEntity['scope'],
    from: Date,
    to: Date,
    granularity?: 'hour' | 'day',
  ): Promise<AnalyticsSnapshotEntity[]>;
  summary(guildId: string): Promise<Record<string, number>>;
}

/** Aggregat aller Repositories — wird per Dependency Injection durchgereicht. */
export interface DataStore {
  readonly kind: 'prisma' | 'memory';
  users: UserRepository;
  guilds: GuildRepository;
  moderation: ModerationRepository;
  security: SecurityRepository;
  audit: AuditRepository;
  tickets: TicketRepository;
  levels: LevelRepository;
  economy: EconomyRepository;
  verification: VerificationRepository;
  roblox: RobloxRepository;
  rewards: RewardRepository;
  achievements: AchievementRepository;
  promos: PromoRepository;
  giveaways: GiveawayRepository;
  automations: AutomationRepository;
  backups: BackupRepository;
  apiKeys: ApiKeyRepository;
  notifications: NotificationRepository;
  analytics: AnalyticsRepository;
  healthy(): Promise<boolean>;
  disconnect(): Promise<void>;
}
