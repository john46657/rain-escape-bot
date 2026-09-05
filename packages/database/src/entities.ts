/**
 * Domaenen-Entitaeten.
 *
 * Bewusst handgeschrieben und unabhaengig vom generierten Prisma-Client:
 * Module und Services haengen ausschliesslich an diesen Typen (Ports &
 * Adapters). Vorteile:
 *   - Die Anwendung ist nicht an eine ORM-Codegenerierung gekoppelt.
 *   - Fuer Tests und den Offline-Dev-Modus existiert ein In-Memory-Adapter
 *     mit identischer Semantik.
 *   - JSON-Text-Spalten aus dem Schema werden hier bereits typisiert.
 */
import type {
  AchievementRarity,
  AutomodAction,
  AutomodRule,
  IncidentSeverity,
  IncidentStatus,
  Locale,
  ModerationAction,
  PremiumTier,
  TicketCategory,
  TicketStatus,
  TransactionType,
  VerificationStatus,
} from '@nexus/shared';

export interface UserEntity {
  id: string;
  discordId: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
  locale: Locale;
  isBotOwner: boolean;
  blacklisted: boolean;
  createdAt: Date;
  lastSeenAt: Date | null;
}

export interface GuildEntity {
  id: string;
  discordId: string;
  name: string;
  icon: string | null;
  ownerId: string;
  memberCount: number;
  premiumTier: PremiumTier;
  premiumUntil: Date | null;
  locale: Locale;
  active: boolean;
  joinedAt: Date;
}

export interface AutomodRuleConfig {
  enabled: boolean;
  action: AutomodAction;
  /** Schwellenwert; Bedeutung haengt von der Regel ab (Nachrichten, Prozent, ...). */
  threshold: number;
  windowSeconds: number;
  timeoutMs?: number;
  exemptRoleIds: string[];
  exemptChannelIds: string[];
  /** Nur fuer BAD_WORDS / ANTI_LINK: zusaetzliche Begriffe bzw. erlaubte Domains. */
  entries?: string[];
}

export interface AntiNukeThresholds {
  banPerMinute: number;
  kickPerMinute: number;
  channelDeletePerMinute: number;
  roleDeletePerMinute: number;
  webhookCreatePerMinute: number;
  memberUpdatePerMinute: number;
  botAddPerHour: number;
}

export interface GuildConfigEntity {
  guildId: string;
  timezone: string;
  modLogChannelId: string | null;
  auditLogChannelId: string | null;
  securityChannelId: string | null;
  robloxLogChannelId: string | null;

  moderationEnabled: boolean;
  automodEnabled: boolean;
  antiNukeEnabled: boolean;
  ticketsEnabled: boolean;
  levelsEnabled: boolean;
  economyEnabled: boolean;
  gamesEnabled: boolean;
  giveawaysEnabled: boolean;
  musicEnabled: boolean;
  aiEnabled: boolean;
  robloxEnabled: boolean;

  welcomeChannelId: string | null;
  welcomeMessage: string | null;
  goodbyeChannelId: string | null;
  goodbyeMessage: string | null;
  boostChannelId: string | null;
  suggestionChannelId: string | null;
  starboardChannelId: string | null;
  starboardThreshold: number;
  birthdayChannelId: string | null;
  autoRoleIds: string[];
  memberCounters: Array<{ channelId: string; template: string }>;

  xpPerMessage: number;
  xpCooldownSeconds: number;
  xpMultiplier: number;
  levelUpChannelId: string | null;
  levelUpMessage: string | null;
  xpIgnoredChannels: string[];

  currencyName: string;
  currencySymbol: string;
  dailyAmount: number;
  weeklyAmount: number;
  workMinAmount: number;
  workMaxAmount: number;
  startingBalance: number;

  antiNukeWhitelist: string[];
  automodConfig: Partial<Record<AutomodRule, AutomodRuleConfig>>;
  antiNukeThresholds: Partial<AntiNukeThresholds>;
  raidModeEnabled: boolean;
  minAccountAgeDays: number;
  lockdownActive: boolean;
  lockdownReason: string | null;
  lockdownAt: Date | null;
  lockdownBy: string | null;
  lockdownSnapshot: Array<{ channelId: string; previousOverwrites: unknown }>;

  verifiedRoleId: string | null;
  unverifiedRoleId: string | null;
  robloxNicknameSync: boolean;
  nicknameTemplate: string;
}

export interface PermissionGrantEntity {
  id: string;
  guildId: string;
  subjectId: string;
  subjectType: 'role' | 'user';
  allow: string[];
  deny: string[];
}

export interface ModerationCaseEntity {
  id: string;
  guildId: string;
  sequence: number;
  caseId: string;
  action: ModerationAction;
  targetId: string;
  targetTag: string | null;
  moderatorId: string;
  moderatorTag: string | null;
  reason: string;
  source: 'COMMAND' | 'AUTOMOD' | 'ANTINUKE' | 'DASHBOARD' | 'API' | 'AUTOMATION';
  previousState: Record<string, unknown>;
  newState: Record<string, unknown>;
  durationMs: number | null;
  expiresAt: Date | null;
  active: boolean;
  revoked: boolean;
  revokedById: string | null;
  revokedAt: Date | null;
  logMessageId: string | null;
  createdAt: Date;
}

export interface WarningEntity {
  id: string;
  guildId: string;
  caseRef: string | null;
  targetId: string;
  moderatorId: string;
  reason: string;
  points: number;
  active: boolean;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface SecurityIncidentEntity {
  id: string;
  guildId: string | null;
  kind: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  description: string;
  actorId: string | null;
  actorType: 'discord' | 'roblox' | 'api' | null;
  robloxGameId: string | null;
  evidence: Record<string, unknown>;
  actionsTaken: string[];
  acknowledgedBy: string | null;
  resolvedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLogEntity {
  id: string;
  guildId: string | null;
  actorId: string;
  actorType: 'discord' | 'api' | 'system' | 'dashboard';
  action: string;
  targetId: string | null;
  targetType: string | null;
  result: 'SUCCESS' | 'DENIED' | 'FAILED';
  reason: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface TicketEntity {
  id: string;
  guildId: string;
  panelId: string | null;
  number: number;
  channelId: string;
  openerId: string;
  category: TicketCategory;
  subject: string | null;
  status: TicketStatus;
  claimedById: string | null;
  closedById: string | null;
  closedAt: Date | null;
  closeReason: string | null;
  reopenCount: number;
  rating: number | null;
  formData: Record<string, unknown>;
  transcriptUrl: string | null;
  createdAt: Date;
}

export interface TicketMessageEntity {
  id: string;
  ticketId: string;
  messageId: string;
  authorId: string;
  authorTag: string;
  content: string;
  attachments: Array<{ url: string; name: string; contentType?: string }>;
  isStaff: boolean;
  createdAt: Date;
}

export interface XPProfileEntity {
  guildId: string;
  userId: string;
  xp: number;
  level: number;
  totalXp: number;
  prestige: number;
  messages: number;
  voiceMinutes: number;
  lastXpAt: Date | null;
}

export interface EconomyProfileEntity {
  id: string;
  guildId: string;
  userId: string;
  wallet: number;
  bank: number;
  bankCapacity: number;
  version: number;
  totalEarned: number;
  totalSpent: number;
  streakDays: number;
  lastDailyAt: Date | null;
  lastWeeklyAt: Date | null;
  lastWorkAt: Date | null;
  lastCrimeAt: Date | null;
  lastRobAt: Date | null;
}

export interface TransactionEntity {
  id: string;
  guildId: string;
  userId: string;
  type: TransactionType;
  amount: number;
  balanceAfter: number;
  counterpartyId: string | null;
  reason: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
}

export interface ItemEntity {
  id: string;
  guildId: string;
  key: string;
  name: string;
  description: string;
  emoji: string | null;
  price: number;
  sellPrice: number;
  kind: 'consumable' | 'collectible' | 'role' | 'robloxReward';
  roleId: string | null;
  payload: Record<string, unknown>;
  stock: number;
  maxPerUser: number;
  tradable: boolean;
  enabled: boolean;
}

export interface InventoryEntryEntity {
  itemId: string;
  itemKey: string;
  name: string;
  emoji: string | null;
  quantity: number;
  tradable: boolean;
}

export interface GiveawayRequirements {
  roleIds?: string[];
  minLevel?: number;
  minAccountAgeDays?: number;
  requireRobloxVerified?: boolean;
  minRobloxLevel?: number;
}

export interface GiveawayEntity {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string | null;
  hostId: string;
  prize: string;
  description: string | null;
  winnerCount: number;
  endsAt: Date;
  ended: boolean;
  requirements: GiveawayRequirements;
  entries: string[];
  winners: string[];
  rerollCount: number;
  createdAt: Date;
}

export interface RobloxAccountEntity {
  id: string;
  userId: string;
  discordId: string;
  robloxUserId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  previousUsername: string | null;
  verifiedAt: Date;
  method: 'game' | 'oauth' | 'manual';
  lastSyncedAt: Date | null;
}

export interface VerificationEntity {
  id: string;
  userId: string;
  discordId: string;
  codeHash: string;
  codeHint: string;
  guildId: string | null;
  gameId: string | null;
  status: VerificationStatus;
  attempts: number;
  maxAttempts: number;
  robloxUserId: string | null;
  expiresAt: Date;
  createdAt: Date;
}

export interface RobloxGameEntity {
  id: string;
  guildId: string;
  universeId: string;
  placeId: string | null;
  name: string;
  iconUrl: string | null;
  signingSecretHash: string;
  secretHint: string;
  active: boolean;
  settings: Record<string, unknown>;
  lastEventAt: Date | null;
}

export interface RobloxServerEntity {
  id: string;
  gameId: string;
  jobId: string;
  placeId: string | null;
  region: string | null;
  playerCount: number;
  maxPlayers: number;
  version: string | null;
  fps: number | null;
  memoryMb: number | null;
  startedAt: Date;
  lastHeartbeatAt: Date;
  status: 'online' | 'stale' | 'offline';
  players: Array<{ userId: string; username?: string; displayName?: string }>;
}

export interface RobloxEventEntity {
  id: string;
  gameId: string;
  eventId: string;
  type: string;
  jobId: string | null;
  robloxUserId: string | null;
  payload: Record<string, unknown>;
  occurredAt: Date;
  receivedAt: Date;
  processedAt: Date | null;
  error: string | null;
}

export interface RobloxCommandEntity {
  id: string;
  gameId: string;
  type: string;
  jobId: string | null;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'DELIVERED' | 'ACKNOWLEDGED' | 'FAILED' | 'EXPIRED';
  issuedById: string;
  guildId: string | null;
  confirmedById: string | null;
  deliveredAt: Date | null;
  acknowledgedAt: Date | null;
  result: string | null;
  error: string | null;
  expiresAt: Date;
  createdAt: Date;
}

export interface RobloxRankMapping {
  rank: number;
  rankName: string;
  roleId: string;
}

export interface RobloxGroupEntity {
  id: string;
  guildId: string;
  groupId: string;
  name: string;
  syncEnabled: boolean;
  removeOnLeave: boolean;
  rankMapping: RobloxRankMapping[];
  lastSyncAt: Date | null;
}

export interface RewardGrantEntity {
  id: string;
  userId: string;
  guildId: string | null;
  idempotencyKey: string;
  kind: 'discord_xp' | 'discord_coins' | 'discord_role' | 'roblox_reward';
  amount: number;
  reference: string | null;
  status: 'PENDING' | 'GRANTED' | 'FAILED';
  source: string;
  createdAt: Date;
}

export interface AchievementEntity {
  id: string;
  guildId: string;
  key: string;
  name: string;
  description: string;
  rarity: AchievementRarity;
  icon: string | null;
  hidden: boolean;
  origin: 'discord' | 'roblox' | 'cross';
  rewards: { xp?: number; coins?: number; roleId?: string; robloxReward?: { key: string; amount: number } };
  condition: Record<string, unknown>;
  enabled: boolean;
}

export interface PromoCodeEntity {
  id: string;
  guildId: string;
  code: string;
  reward: {
    coins?: number;
    xp?: number;
    roleId?: string;
    itemKey?: string;
    robloxReward?: { key: string; amount: number };
  };
  maxUses: number;
  uses: number;
  perUserLimit: number;
  gameId: string | null;
  expiresAt: Date | null;
  enabled: boolean;
  createdById: string;
  createdAt: Date;
}

export interface AutomationCondition {
  field: string;
  operator:
    'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'startsWith' | 'regex' | 'in' | 'exists';
  value: unknown;
}

export interface AutomationAction {
  type:
    | 'discord.role.add'
    | 'discord.role.remove'
    | 'discord.message.send'
    | 'discord.dm.send'
    | 'discord.xp.add'
    | 'discord.coins.add'
    | 'discord.timeout'
    | 'roblox.reward.grant'
    | 'roblox.announce'
    | 'roblox.kick'
    | 'notification.send'
    | 'webhook.call';
  params: Record<string, unknown>;
  delayMs?: number;
}

export interface AutomationEntity {
  id: string;
  guildId: string;
  name: string;
  description: string | null;
  enabled: boolean;
  trigger: string;
  schedule: string | null;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  rateLimitPerHour: number;
  runCount: number;
  errorCount: number;
  lastRunAt: Date | null;
  lastError: string | null;
}

export interface BackupEntity {
  id: string;
  guildId: string;
  name: string;
  createdById: string;
  summary: Record<string, number>;
  sizeBytes: number;
  checksum: string;
  restoredAt: Date | null;
  createdAt: Date;
}

export interface ApiKeyEntity {
  id: string;
  guildId: string | null;
  ownerId: string;
  name: string;
  keyHash: string;
  prefix: string;
  last4: string;
  scopes: string[];
  rateLimitPerMinute: number;
  environment: 'live' | 'test';
  lastUsedAt: Date | null;
  usageCount: number;
  revokedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface NotificationEntity {
  id: string;
  guildId: string | null;
  userId: string | null;
  category: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: Date;
}

export interface AnalyticsSnapshotEntity {
  guildId: string;
  granularity: 'hour' | 'day';
  bucket: Date;
  scope: 'discord' | 'roblox' | 'cross';
  metrics: Record<string, number>;
}
