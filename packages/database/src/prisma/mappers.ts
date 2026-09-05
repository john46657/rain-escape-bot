/** Konvertierung DB-Zeile -> Domaenen-Entitaet (inkl. JSON-Spalten). */
import { parseJson } from '../json.js';
import { DEFAULT_ANTINUKE, DEFAULT_AUTOMOD, defaultGuildConfig } from '../defaults.js';
import type {
  AchievementEntity, AnalyticsSnapshotEntity, ApiKeyEntity, AuditLogEntity, AutomationEntity,
  BackupEntity, EconomyProfileEntity, GiveawayEntity, GuildConfigEntity, GuildEntity,
  ItemEntity, ModerationCaseEntity, NotificationEntity, PermissionGrantEntity, PromoCodeEntity,
  RewardGrantEntity, RobloxAccountEntity, RobloxCommandEntity, RobloxEventEntity,
  RobloxGameEntity, RobloxGroupEntity, RobloxServerEntity, SecurityIncidentEntity,
  TicketEntity, TicketMessageEntity, TransactionEntity, UserEntity, VerificationEntity,
  WarningEntity, XPProfileEntity,
} from '../entities.js';
import type { Row } from './client-contract.js';

const str = (row: Row, key: string): string => String(row[key] ?? '');
const strOrNull = (row: Row, key: string): string | null => (row[key] == null ? null : String(row[key]));
const num = (row: Row, key: string, fallback = 0): number => {
  const value = row[key];
  return typeof value === 'number' ? value : Number(value ?? fallback);
};
const numOrNull = (row: Row, key: string): number | null => (row[key] == null ? null : Number(row[key]));
const bool = (row: Row, key: string, fallback = false): boolean =>
  typeof row[key] === 'boolean' ? (row[key] as boolean) : fallback;
const date = (row: Row, key: string): Date => new Date(row[key] as string | number | Date);
const dateOrNull = (row: Row, key: string): Date | null => (row[key] == null ? null : new Date(row[key] as string));
const json = <T>(row: Row, key: string, fallback: T): T => parseJson<T>(row[key] as string | null, fallback);

export const toUser = (row: Row): UserEntity => ({
  id: str(row, 'id'),
  discordId: str(row, 'id'),
  username: str(row, 'username'),
  globalName: strOrNull(row, 'globalName'),
  avatar: strOrNull(row, 'avatar'),
  locale: (str(row, 'locale') === 'en' ? 'en' : 'de'),
  isBotOwner: bool(row, 'isBotOwner'),
  blacklisted: bool(row, 'blacklisted'),
  createdAt: date(row, 'createdAt'),
  lastSeenAt: dateOrNull(row, 'lastSeenAt'),
});

export const toGuild = (row: Row): GuildEntity => ({
  id: str(row, 'id'),
  discordId: str(row, 'id'),
  name: str(row, 'name'),
  icon: strOrNull(row, 'icon'),
  ownerId: str(row, 'ownerId'),
  memberCount: num(row, 'memberCount'),
  premiumTier: (['FREE', 'PREMIUM', 'PREMIUM_PLUS'].includes(str(row, 'premiumTier'))
    ? str(row, 'premiumTier')
    : 'FREE') as GuildEntity['premiumTier'],
  premiumUntil: dateOrNull(row, 'premiumUntil'),
  locale: (str(row, 'locale') === 'en' ? 'en' : 'de'),
  active: bool(row, 'active', true),
  joinedAt: date(row, 'joinedAt'),
});

export function toGuildConfig(guildId: string, row: Row | null): GuildConfigEntity {
  const defaults = defaultGuildConfig(guildId);
  if (!row) return defaults;
  return {
    guildId,
    timezone: str(row, 'timezone') || defaults.timezone,
    modLogChannelId: strOrNull(row, 'modLogChannelId'),
    auditLogChannelId: strOrNull(row, 'auditLogChannelId'),
    securityChannelId: strOrNull(row, 'securityChannelId'),
    robloxLogChannelId: strOrNull(row, 'robloxLogChannelId'),
    moderationEnabled: bool(row, 'moderationEnabled', true),
    automodEnabled: bool(row, 'automodEnabled', true),
    antiNukeEnabled: bool(row, 'antiNukeEnabled', true),
    ticketsEnabled: bool(row, 'ticketsEnabled', true),
    levelsEnabled: bool(row, 'levelsEnabled', true),
    economyEnabled: bool(row, 'economyEnabled', true),
    gamesEnabled: bool(row, 'gamesEnabled', true),
    giveawaysEnabled: bool(row, 'giveawaysEnabled', true),
    musicEnabled: bool(row, 'musicEnabled'),
    aiEnabled: bool(row, 'aiEnabled'),
    robloxEnabled: bool(row, 'robloxEnabled'),
    welcomeChannelId: strOrNull(row, 'welcomeChannelId'),
    welcomeMessage: strOrNull(row, 'welcomeMessage'),
    goodbyeChannelId: strOrNull(row, 'goodbyeChannelId'),
    goodbyeMessage: strOrNull(row, 'goodbyeMessage'),
    boostChannelId: strOrNull(row, 'boostChannelId'),
    suggestionChannelId: strOrNull(row, 'suggestionChannelId'),
    starboardChannelId: strOrNull(row, 'starboardChannelId'),
    starboardThreshold: num(row, 'starboardThreshold', defaults.starboardThreshold),
    birthdayChannelId: strOrNull(row, 'birthdayChannelId'),
    autoRoleIds: json<string[]>(row, 'autoRoleIds', []),
    memberCounters: json(row, 'memberCounters', defaults.memberCounters),
    xpPerMessage: num(row, 'xpPerMessage', defaults.xpPerMessage),
    xpCooldownSeconds: num(row, 'xpCooldownSeconds', defaults.xpCooldownSeconds),
    xpMultiplier: num(row, 'xpMultiplier', 1),
    levelUpChannelId: strOrNull(row, 'levelUpChannelId'),
    levelUpMessage: strOrNull(row, 'levelUpMessage'),
    xpIgnoredChannels: json<string[]>(row, 'xpIgnoredChannels', []),
    currencyName: str(row, 'currencyName') || defaults.currencyName,
    currencySymbol: str(row, 'currencySymbol') || defaults.currencySymbol,
    dailyAmount: num(row, 'dailyAmount', defaults.dailyAmount),
    weeklyAmount: num(row, 'weeklyAmount', defaults.weeklyAmount),
    workMinAmount: num(row, 'workMinAmount', defaults.workMinAmount),
    workMaxAmount: num(row, 'workMaxAmount', defaults.workMaxAmount),
    startingBalance: num(row, 'startingBalance', defaults.startingBalance),
    antiNukeWhitelist: json<string[]>(row, 'antiNukeWhitelist', []),
    automodConfig: { ...DEFAULT_AUTOMOD, ...json(row, 'automodConfig', {}) },
    antiNukeThresholds: { ...DEFAULT_ANTINUKE, ...json(row, 'antiNukeThresholds', {}) },
    raidModeEnabled: bool(row, 'raidModeEnabled'),
    minAccountAgeDays: num(row, 'minAccountAgeDays'),
    lockdownActive: bool(row, 'lockdownActive'),
    lockdownReason: strOrNull(row, 'lockdownReason'),
    lockdownAt: dateOrNull(row, 'lockdownAt'),
    lockdownBy: strOrNull(row, 'lockdownBy'),
    lockdownSnapshot: json(row, 'lockdownSnapshot', defaults.lockdownSnapshot),
    verifiedRoleId: strOrNull(row, 'verifiedRoleId'),
    unverifiedRoleId: strOrNull(row, 'unverifiedRoleId'),
    robloxNicknameSync: bool(row, 'robloxNicknameSync'),
    nicknameTemplate: str(row, 'nicknameTemplate') || defaults.nicknameTemplate,
  };
}

export const toPermissionGrant = (row: Row): PermissionGrantEntity => ({
  id: str(row, 'id'),
  guildId: str(row, 'guildId'),
  subjectId: str(row, 'subjectId'),
  subjectType: str(row, 'subjectType') === 'user' ? 'user' : 'role',
  allow: json<string[]>(row, 'allow', []),
  deny: json<string[]>(row, 'deny', []),
});

export const toCase = (row: Row): ModerationCaseEntity => ({
  id: str(row, 'id'),
  guildId: str(row, 'guildId'),
  sequence: num(row, 'sequence'),
  caseId: str(row, 'caseId'),
  action: str(row, 'action') as ModerationCaseEntity['action'],
  targetId: str(row, 'targetId'),
  targetTag: strOrNull(row, 'targetTag'),
  moderatorId: str(row, 'moderatorId'),
  moderatorTag: strOrNull(row, 'moderatorTag'),
  reason: str(row, 'reason'),
  source: str(row, 'source') as ModerationCaseEntity['source'],
  previousState: json<Record<string, unknown>>(row, 'previousState', {}),
  newState: json<Record<string, unknown>>(row, 'newState', {}),
  durationMs: numOrNull(row, 'durationMs'),
  expiresAt: dateOrNull(row, 'expiresAt'),
  active: bool(row, 'active', true),
  revoked: bool(row, 'revoked'),
  revokedById: strOrNull(row, 'revokedById'),
  revokedAt: dateOrNull(row, 'revokedAt'),
  logMessageId: strOrNull(row, 'logMessageId'),
  createdAt: date(row, 'createdAt'),
});

export const toWarning = (row: Row): WarningEntity => ({
  id: str(row, 'id'),
  guildId: str(row, 'guildId'),
  caseRef: strOrNull(row, 'caseRef'),
  targetId: str(row, 'targetId'),
  moderatorId: str(row, 'moderatorId'),
  reason: str(row, 'reason'),
  points: num(row, 'points', 1),
  active: bool(row, 'active', true),
  expiresAt: dateOrNull(row, 'expiresAt'),
  createdAt: date(row, 'createdAt'),
});

export const toIncident = (row: Row): SecurityIncidentEntity => ({
  id: str(row, 'id'),
  guildId: strOrNull(row, 'guildId'),
  kind: str(row, 'kind'),
  severity: str(row, 'severity') as SecurityIncidentEntity['severity'],
  status: str(row, 'status') as SecurityIncidentEntity['status'],
  title: str(row, 'title'),
  description: str(row, 'description'),
  actorId: strOrNull(row, 'actorId'),
  actorType: strOrNull(row, 'actorType') as SecurityIncidentEntity['actorType'],
  robloxGameId: strOrNull(row, 'robloxGameId'),
  evidence: json<Record<string, unknown>>(row, 'evidence', {}),
  actionsTaken: json<string[]>(row, 'actionsTaken', []),
  acknowledgedBy: strOrNull(row, 'acknowledgedBy'),
  resolvedBy: strOrNull(row, 'resolvedBy'),
  createdAt: date(row, 'createdAt'),
  updatedAt: date(row, 'updatedAt'),
});

export const toAudit = (row: Row): AuditLogEntity => ({
  id: str(row, 'id'),
  guildId: strOrNull(row, 'guildId'),
  actorId: str(row, 'actorId'),
  actorType: str(row, 'actorType') as AuditLogEntity['actorType'],
  action: str(row, 'action'),
  targetId: strOrNull(row, 'targetId'),
  targetType: strOrNull(row, 'targetType'),
  result: str(row, 'result') as AuditLogEntity['result'],
  reason: strOrNull(row, 'reason'),
  metadata: json<Record<string, unknown>>(row, 'metadata', {}),
  createdAt: date(row, 'createdAt'),
});

export const toTicket = (row: Row): TicketEntity => ({
  id: str(row, 'id'),
  guildId: str(row, 'guildId'),
  panelId: strOrNull(row, 'panelId'),
  number: num(row, 'number'),
  channelId: str(row, 'channelId'),
  openerId: str(row, 'openerId'),
  category: str(row, 'category') as TicketEntity['category'],
  subject: strOrNull(row, 'subject'),
  status: str(row, 'status') as TicketEntity['status'],
  claimedById: strOrNull(row, 'claimedById'),
  closedById: strOrNull(row, 'closedById'),
  closedAt: dateOrNull(row, 'closedAt'),
  closeReason: strOrNull(row, 'closeReason'),
  reopenCount: num(row, 'reopenCount'),
  rating: numOrNull(row, 'rating'),
  formData: json<Record<string, unknown>>(row, 'formData', {}),
  transcriptUrl: strOrNull(row, 'transcriptUrl'),
  createdAt: date(row, 'createdAt'),
});

export const toTicketMessage = (row: Row): TicketMessageEntity => ({
  id: str(row, 'id'),
  ticketId: str(row, 'ticketId'),
  messageId: str(row, 'messageId'),
  authorId: str(row, 'authorId'),
  authorTag: str(row, 'authorTag'),
  content: str(row, 'content'),
  attachments: json<TicketMessageEntity['attachments']>(row, 'attachments', []),
  isStaff: bool(row, 'isStaff'),
  createdAt: date(row, 'createdAt'),
});

export const toXp = (row: Row): XPProfileEntity => ({
  guildId: str(row, 'guildId'),
  userId: str(row, 'userId'),
  xp: num(row, 'xp'),
  level: num(row, 'level'),
  totalXp: num(row, 'totalXp'),
  prestige: num(row, 'prestige'),
  messages: num(row, 'messages'),
  voiceMinutes: num(row, 'voiceMinutes'),
  lastXpAt: dateOrNull(row, 'lastXpAt'),
});

export const toEconomy = (row: Row): EconomyProfileEntity => ({
  id: str(row, 'id'),
  guildId: str(row, 'guildId'),
  userId: str(row, 'userId'),
  wallet: num(row, 'wallet'),
  bank: num(row, 'bank'),
  bankCapacity: num(row, 'bankCapacity', 10_000),
  version: num(row, 'version'),
  totalEarned: num(row, 'totalEarned'),
  totalSpent: num(row, 'totalSpent'),
  streakDays: num(row, 'streakDays'),
  lastDailyAt: dateOrNull(row, 'lastDailyAt'),
  lastWeeklyAt: dateOrNull(row, 'lastWeeklyAt'),
  lastWorkAt: dateOrNull(row, 'lastWorkAt'),
  lastCrimeAt: dateOrNull(row, 'lastCrimeAt'),
  lastRobAt: dateOrNull(row, 'lastRobAt'),
});

export const toTransaction = (row: Row): TransactionEntity => ({
  id: str(row, 'id'),
  guildId: str(row, 'guildId'),
  userId: str(row, 'userId'),
  type: str(row, 'type') as TransactionEntity['type'],
  amount: num(row, 'amount'),
  balanceAfter: num(row, 'balanceAfter'),
  counterpartyId: strOrNull(row, 'counterpartyId'),
  reason: strOrNull(row, 'reason'),
  idempotencyKey: strOrNull(row, 'idempotencyKey'),
  createdAt: date(row, 'createdAt'),
});

export const toItem = (row: Row): ItemEntity => ({
  id: str(row, 'id'),
  guildId: str(row, 'guildId'),
  key: str(row, 'key'),
  name: str(row, 'name'),
  description: str(row, 'description'),
  emoji: strOrNull(row, 'emoji'),
  price: num(row, 'price'),
  sellPrice: num(row, 'sellPrice'),
  kind: str(row, 'kind') as ItemEntity['kind'],
  roleId: strOrNull(row, 'roleId'),
  payload: json<Record<string, unknown>>(row, 'payload', {}),
  stock: num(row, 'stock', -1),
  maxPerUser: num(row, 'maxPerUser', -1),
  tradable: bool(row, 'tradable', true),
  enabled: bool(row, 'enabled', true),
});

export const toGiveaway = (row: Row): GiveawayEntity => ({
  id: str(row, 'id'),
  guildId: str(row, 'guildId'),
  channelId: str(row, 'channelId'),
  messageId: strOrNull(row, 'messageId'),
  hostId: str(row, 'hostId'),
  prize: str(row, 'prize'),
  description: strOrNull(row, 'description'),
  winnerCount: num(row, 'winnerCount', 1),
  endsAt: date(row, 'endsAt'),
  ended: bool(row, 'ended'),
  requirements: json(row, 'requirements', {}),
  entries: json<string[]>(row, 'entries', []),
  winners: json<string[]>(row, 'winners', []),
  rerollCount: num(row, 'rerollCount'),
  createdAt: date(row, 'createdAt'),
});

export const toRobloxAccount = (row: Row, discordId: string): RobloxAccountEntity => ({
  id: str(row, 'id'),
  userId: str(row, 'userId'),
  discordId,
  robloxUserId: str(row, 'robloxUserId'),
  username: str(row, 'username'),
  displayName: strOrNull(row, 'displayName'),
  avatarUrl: strOrNull(row, 'avatarUrl'),
  previousUsername: strOrNull(row, 'previousUsername'),
  verifiedAt: date(row, 'verifiedAt'),
  method: str(row, 'method') as RobloxAccountEntity['method'],
  lastSyncedAt: dateOrNull(row, 'lastSyncedAt'),
});

export const toVerification = (row: Row, discordId: string): VerificationEntity => ({
  id: str(row, 'id'),
  userId: str(row, 'userId'),
  discordId,
  codeHash: str(row, 'codeHash'),
  codeHint: str(row, 'codeHint'),
  guildId: strOrNull(row, 'guildId'),
  gameId: strOrNull(row, 'gameId'),
  status: str(row, 'status') as VerificationEntity['status'],
  attempts: num(row, 'attempts'),
  maxAttempts: num(row, 'maxAttempts', 5),
  robloxUserId: strOrNull(row, 'robloxUserId'),
  expiresAt: date(row, 'expiresAt'),
  createdAt: date(row, 'createdAt'),
});

export const toGame = (row: Row): RobloxGameEntity => ({
  id: str(row, 'id'),
  guildId: str(row, 'guildId'),
  universeId: str(row, 'universeId'),
  placeId: strOrNull(row, 'placeId'),
  name: str(row, 'name'),
  iconUrl: strOrNull(row, 'iconUrl'),
  signingSecretHash: str(row, 'signingSecretHash'),
  secretHint: str(row, 'secretHint'),
  active: bool(row, 'active', true),
  settings: json<Record<string, unknown>>(row, 'settings', {}),
  lastEventAt: dateOrNull(row, 'lastEventAt'),
});

export const toServer = (row: Row): RobloxServerEntity => ({
  id: str(row, 'id'),
  gameId: str(row, 'gameId'),
  jobId: str(row, 'jobId'),
  placeId: strOrNull(row, 'placeId'),
  region: strOrNull(row, 'region'),
  playerCount: num(row, 'playerCount'),
  maxPlayers: num(row, 'maxPlayers'),
  version: strOrNull(row, 'version'),
  fps: numOrNull(row, 'fps'),
  memoryMb: numOrNull(row, 'memoryMb'),
  startedAt: date(row, 'startedAt'),
  lastHeartbeatAt: date(row, 'lastHeartbeatAt'),
  status: str(row, 'status') as RobloxServerEntity['status'],
  players: json<RobloxServerEntity['players']>(row, 'players', []),
});

export const toEvent = (row: Row): RobloxEventEntity => ({
  id: str(row, 'id'),
  gameId: str(row, 'gameId'),
  eventId: str(row, 'eventId'),
  type: str(row, 'type'),
  jobId: strOrNull(row, 'jobId'),
  robloxUserId: strOrNull(row, 'robloxUserId'),
  payload: json<Record<string, unknown>>(row, 'payload', {}),
  occurredAt: date(row, 'occurredAt'),
  receivedAt: date(row, 'receivedAt'),
  processedAt: dateOrNull(row, 'processedAt'),
  error: strOrNull(row, 'error'),
});

export const toCommand = (row: Row): RobloxCommandEntity => ({
  id: str(row, 'id'),
  gameId: str(row, 'gameId'),
  type: str(row, 'type'),
  jobId: strOrNull(row, 'jobId'),
  payload: json<Record<string, unknown>>(row, 'payload', {}),
  status: str(row, 'status') as RobloxCommandEntity['status'],
  issuedById: str(row, 'issuedById'),
  guildId: strOrNull(row, 'guildId'),
  confirmedById: strOrNull(row, 'confirmedById'),
  deliveredAt: dateOrNull(row, 'deliveredAt'),
  acknowledgedAt: dateOrNull(row, 'acknowledgedAt'),
  result: strOrNull(row, 'result'),
  error: strOrNull(row, 'error'),
  expiresAt: date(row, 'expiresAt'),
  createdAt: date(row, 'createdAt'),
});

export const toGroup = (row: Row): RobloxGroupEntity => ({
  id: str(row, 'id'),
  guildId: str(row, 'guildId'),
  groupId: str(row, 'groupId'),
  name: str(row, 'name'),
  syncEnabled: bool(row, 'syncEnabled', true),
  removeOnLeave: bool(row, 'removeOnLeave', true),
  rankMapping: json<RobloxGroupEntity['rankMapping']>(row, 'rankMapping', []),
  lastSyncAt: dateOrNull(row, 'lastSyncAt'),
});

export const toRewardGrant = (row: Row): RewardGrantEntity => ({
  id: str(row, 'id'),
  userId: str(row, 'userId'),
  guildId: strOrNull(row, 'guildId'),
  idempotencyKey: str(row, 'idempotencyKey'),
  kind: str(row, 'kind') as RewardGrantEntity['kind'],
  amount: num(row, 'amount'),
  reference: strOrNull(row, 'reference'),
  status: str(row, 'status') as RewardGrantEntity['status'],
  source: str(row, 'source'),
  createdAt: date(row, 'createdAt'),
});

export const toAchievement = (row: Row): AchievementEntity => ({
  id: str(row, 'id'),
  guildId: str(row, 'guildId'),
  key: str(row, 'key'),
  name: str(row, 'name'),
  description: str(row, 'description'),
  rarity: str(row, 'rarity') as AchievementEntity['rarity'],
  icon: strOrNull(row, 'icon'),
  hidden: bool(row, 'hidden'),
  origin: str(row, 'origin') as AchievementEntity['origin'],
  rewards: json<AchievementEntity['rewards']>(row, 'rewards', {}),
  condition: json<Record<string, unknown>>(row, 'condition', {}),
  enabled: bool(row, 'enabled', true),
});

export const toPromo = (row: Row): PromoCodeEntity => ({
  id: str(row, 'id'),
  guildId: str(row, 'guildId'),
  code: str(row, 'code'),
  reward: json<PromoCodeEntity['reward']>(row, 'reward', {}),
  maxUses: num(row, 'maxUses', -1),
  uses: num(row, 'uses'),
  perUserLimit: num(row, 'perUserLimit', 1),
  gameId: strOrNull(row, 'gameId'),
  expiresAt: dateOrNull(row, 'expiresAt'),
  enabled: bool(row, 'enabled', true),
  createdById: str(row, 'createdById'),
  createdAt: date(row, 'createdAt'),
});

export const toAutomation = (row: Row): AutomationEntity => ({
  id: str(row, 'id'),
  guildId: str(row, 'guildId'),
  name: str(row, 'name'),
  description: strOrNull(row, 'description'),
  enabled: bool(row, 'enabled', true),
  trigger: str(row, 'trigger'),
  schedule: strOrNull(row, 'schedule'),
  conditions: json<AutomationEntity['conditions']>(row, 'conditions', []),
  actions: json<AutomationEntity['actions']>(row, 'actions', []),
  rateLimitPerHour: num(row, 'rateLimitPerHour', 120),
  runCount: num(row, 'runCount'),
  errorCount: num(row, 'errorCount'),
  lastRunAt: dateOrNull(row, 'lastRunAt'),
  lastError: strOrNull(row, 'lastError'),
});

export const toBackup = (row: Row): BackupEntity => ({
  id: str(row, 'id'),
  guildId: str(row, 'guildId'),
  name: str(row, 'name'),
  createdById: str(row, 'createdById'),
  summary: json<Record<string, number>>(row, 'summary', {}),
  sizeBytes: num(row, 'sizeBytes'),
  checksum: str(row, 'checksum'),
  restoredAt: dateOrNull(row, 'restoredAt'),
  createdAt: date(row, 'createdAt'),
});

export const toApiKey = (row: Row): ApiKeyEntity => ({
  id: str(row, 'id'),
  guildId: strOrNull(row, 'guildId'),
  ownerId: str(row, 'ownerId'),
  name: str(row, 'name'),
  keyHash: str(row, 'keyHash'),
  prefix: str(row, 'prefix'),
  last4: str(row, 'last4'),
  scopes: json<string[]>(row, 'scopes', []),
  rateLimitPerMinute: num(row, 'rateLimitPerMinute', 60),
  environment: str(row, 'environment') === 'test' ? 'test' : 'live',
  lastUsedAt: dateOrNull(row, 'lastUsedAt'),
  usageCount: num(row, 'usageCount'),
  revokedAt: dateOrNull(row, 'revokedAt'),
  expiresAt: dateOrNull(row, 'expiresAt'),
  createdAt: date(row, 'createdAt'),
});

export const toNotification = (row: Row): NotificationEntity => ({
  id: str(row, 'id'),
  guildId: strOrNull(row, 'guildId'),
  userId: strOrNull(row, 'userId'),
  category: str(row, 'category'),
  severity: str(row, 'severity') as NotificationEntity['severity'],
  title: str(row, 'title'),
  body: str(row, 'body'),
  link: strOrNull(row, 'link'),
  read: bool(row, 'read'),
  createdAt: date(row, 'createdAt'),
});

export const toAnalytics = (row: Row): AnalyticsSnapshotEntity => ({
  guildId: str(row, 'guildId'),
  granularity: str(row, 'granularity') === 'hour' ? 'hour' : 'day',
  bucket: date(row, 'bucket'),
  scope: str(row, 'scope') as AnalyticsSnapshotEntity['scope'],
  metrics: json<Record<string, number>>(row, 'metrics', {}),
});
