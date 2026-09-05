/**
 * Prisma-Adapter (Produktionspfad, PostgreSQL).
 *
 * Wichtige Eigenschaften:
 *  - Alle mehrschrittigen Schreibvorgaenge laufen in `$transaction`.
 *  - Geldbewegungen nutzen bedingte Updates (`updateMany` mit Guard) und
 *    optimistisches Locking ueber `version` -> keine Lost Updates.
 *  - Idempotenz ueber Unique-Constraints (`idempotencyKey`, `eventId`).
 *  - `Guild.id` und `User.id` sind Discord-Snowflakes (siehe schema.prisma).
 */
import { ConflictError, NotFoundError, PreconditionError, formatCaseId, retry } from '@nexus/shared';
import { defaultGuildConfig, emptyXpProfile } from '../defaults.js';
import type {
  AchievementEntity, AnalyticsSnapshotEntity, ApiKeyEntity, AuditLogEntity, AutomationEntity,
  BackupEntity, EconomyProfileEntity, GiveawayEntity, GuildConfigEntity, GuildEntity,
  InventoryEntryEntity, ItemEntity, ModerationCaseEntity, NotificationEntity,
  PermissionGrantEntity, PromoCodeEntity, RewardGrantEntity, RobloxAccountEntity,
  RobloxCommandEntity, RobloxEventEntity, RobloxGameEntity, RobloxGroupEntity,
  RobloxServerEntity, SecurityIncidentEntity, TicketEntity, TicketMessageEntity,
  TransactionEntity, UserEntity, VerificationEntity, WarningEntity, XPProfileEntity,
} from '../entities.js';
import { stringifyJson } from '../json.js';
import { levelFromTotalXp, totalXpForLevel } from '../leveling.js';
import type * as P from '../ports.js';
import { type PrismaLike, type Row, isUniqueViolation, loadPrismaClient } from './client-contract.js';
import * as map from './mappers.js';

const pageArgs = (query?: P.PageQuery): { skip: number; take: number; page: number; pageSize: number } => {
  const page = Math.max(1, query?.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, query?.pageSize ?? 25));
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
};

/** Entfernt undefined-Felder, damit Prisma sie nicht als "auf null setzen" wertet. */
function clean(data: Row): Row {
  const output: Row = {};
  for (const [key, value] of Object.entries(data)) if (value !== undefined) output[key] = value;
  return output;
}

export class PrismaDataStore implements P.DataStore {
  readonly kind = 'prisma' as const;

  private constructor(private readonly db: PrismaLike) {}

  static async connect(): Promise<PrismaDataStore> {
    const client = await loadPrismaClient();
    await client.$connect();
    return new PrismaDataStore(client);
  }

  async healthy(): Promise<boolean> {
    try {
      await this.db.$queryRawUnsafe('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    await this.db.$disconnect();
  }

  // =============================================================== Users
  users: P.UserRepository = {
    upsertFromDiscord: async (input): Promise<UserEntity> => {
      const data = clean({
        username: input.username,
        globalName: input.globalName ?? undefined,
        avatar: input.avatar ?? undefined,
        lastSeenAt: new Date(),
      });
      const row = await this.db.user.upsert({
        where: { id: input.discordId },
        create: { id: input.discordId, ...data },
        update: data,
      });
      return map.toUser(row);
    },
    findByDiscordId: async (discordId) => {
      const row = await this.db.user.findUnique({ where: { id: discordId } });
      return row ? map.toUser(row) : null;
    },
    setLocale: async (discordId, locale) => {
      await this.db.user.update({ where: { id: discordId }, data: { locale } });
    },
    setBlacklist: async (discordId, blacklisted, note) => {
      await this.db.user.update({
        where: { id: discordId },
        data: clean({ blacklisted, blacklistNote: note }),
      });
    },
  };

  // ============================================================== Guilds
  guilds: P.GuildRepository = {
    upsert: async (input): Promise<GuildEntity> => {
      const data = clean({
        name: input.name,
        icon: input.icon ?? undefined,
        ownerId: input.ownerId,
        memberCount: input.memberCount ?? undefined,
        active: true,
        leftAt: null,
      });
      const row = await this.db.guild.upsert({
        where: { id: input.discordId },
        create: { id: input.discordId, ...data, config: { create: {} } },
        update: data,
      });
      return map.toGuild(row);
    },
    findByDiscordId: async (discordId) => {
      const row = await this.db.guild.findUnique({ where: { id: discordId } });
      return row ? map.toGuild(row) : null;
    },
    list: async (query) => {
      const { skip, take, page, pageSize } = pageArgs(query);
      const where = clean({ active: query?.active });
      const [rows, total] = await Promise.all([
        this.db.guild.findMany({ where, skip, take, orderBy: { joinedAt: 'desc' } }),
        this.db.guild.count({ where }),
      ]);
      return { items: rows.map(map.toGuild), total, page, pageSize };
    },
    markInactive: async (discordId) => {
      await this.db.guild.update({ where: { id: discordId }, data: { active: false, leftAt: new Date() } });
    },
    setPremium: async (discordId, tier, until) => {
      await this.db.guild.update({
        where: { id: discordId },
        data: { premiumTier: tier, premiumUntil: until ?? null },
      });
    },
    getConfig: async (guildId): Promise<GuildConfigEntity> => {
      const row = await this.db.guildConfig.findUnique({ where: { guildId } });
      return map.toGuildConfig(guildId, row);
    },
    updateConfig: async (guildId, patch): Promise<GuildConfigEntity> => {
      const data = clean({
        timezone: patch.timezone,
        modLogChannelId: patch.modLogChannelId,
        auditLogChannelId: patch.auditLogChannelId,
        securityChannelId: patch.securityChannelId,
        robloxLogChannelId: patch.robloxLogChannelId,
        moderationEnabled: patch.moderationEnabled,
        automodEnabled: patch.automodEnabled,
        antiNukeEnabled: patch.antiNukeEnabled,
        ticketsEnabled: patch.ticketsEnabled,
        levelsEnabled: patch.levelsEnabled,
        economyEnabled: patch.economyEnabled,
        gamesEnabled: patch.gamesEnabled,
        giveawaysEnabled: patch.giveawaysEnabled,
        musicEnabled: patch.musicEnabled,
        aiEnabled: patch.aiEnabled,
        robloxEnabled: patch.robloxEnabled,
        welcomeChannelId: patch.welcomeChannelId,
        welcomeMessage: patch.welcomeMessage,
        goodbyeChannelId: patch.goodbyeChannelId,
        goodbyeMessage: patch.goodbyeMessage,
        boostChannelId: patch.boostChannelId,
        suggestionChannelId: patch.suggestionChannelId,
        starboardChannelId: patch.starboardChannelId,
        starboardThreshold: patch.starboardThreshold,
        birthdayChannelId: patch.birthdayChannelId,
        autoRoleIds: patch.autoRoleIds ? stringifyJson(patch.autoRoleIds) : undefined,
        memberCounters: patch.memberCounters ? stringifyJson(patch.memberCounters) : undefined,
        xpPerMessage: patch.xpPerMessage,
        xpCooldownSeconds: patch.xpCooldownSeconds,
        xpMultiplier: patch.xpMultiplier,
        levelUpChannelId: patch.levelUpChannelId,
        levelUpMessage: patch.levelUpMessage,
        xpIgnoredChannels: patch.xpIgnoredChannels ? stringifyJson(patch.xpIgnoredChannels) : undefined,
        currencyName: patch.currencyName,
        currencySymbol: patch.currencySymbol,
        dailyAmount: patch.dailyAmount,
        weeklyAmount: patch.weeklyAmount,
        workMinAmount: patch.workMinAmount,
        workMaxAmount: patch.workMaxAmount,
        startingBalance: patch.startingBalance,
        antiNukeWhitelist: patch.antiNukeWhitelist ? stringifyJson(patch.antiNukeWhitelist) : undefined,
        automodConfig: patch.automodConfig ? stringifyJson(patch.automodConfig) : undefined,
        antiNukeThresholds: patch.antiNukeThresholds ? stringifyJson(patch.antiNukeThresholds) : undefined,
        raidModeEnabled: patch.raidModeEnabled,
        minAccountAgeDays: patch.minAccountAgeDays,
        lockdownActive: patch.lockdownActive,
        lockdownReason: patch.lockdownReason,
        lockdownAt: patch.lockdownAt,
        lockdownBy: patch.lockdownBy,
        lockdownSnapshot: patch.lockdownSnapshot ? stringifyJson(patch.lockdownSnapshot) : undefined,
        verifiedRoleId: patch.verifiedRoleId,
        unverifiedRoleId: patch.unverifiedRoleId,
        robloxNicknameSync: patch.robloxNicknameSync,
        nicknameTemplate: patch.nicknameTemplate,
      });
      const row = await this.db.guildConfig.upsert({
        where: { guildId },
        create: { guildId, ...data },
        update: data,
      });
      return map.toGuildConfig(guildId, row);
    },
    listPermissionGrants: async (guildId): Promise<PermissionGrantEntity[]> => {
      const rows = await this.db.permissionGrant.findMany({ where: { guildId } });
      return rows.map(map.toPermissionGrant);
    },
    upsertPermissionGrant: async (input) => {
      const data = { allow: stringifyJson(input.allow), deny: stringifyJson(input.deny) };
      const row = await this.db.permissionGrant.upsert({
        where: {
          guildId_subjectId_subjectType: {
            guildId: input.guildId, subjectId: input.subjectId, subjectType: input.subjectType,
          },
        },
        create: { guildId: input.guildId, subjectId: input.subjectId, subjectType: input.subjectType, ...data },
        update: data,
      });
      return map.toPermissionGrant(row);
    },
  };

  // ========================================================== Moderation
  moderation: P.ModerationRepository = {
    /**
     * Fallnummern muessen lueckenlos und eindeutig sein. Die Sequenz wird in
     * einer Transaktion ermittelt; bei einem parallelen Insert greift der
     * Unique-Constraint (guildId, sequence) und der Vorgang wird wiederholt.
     */
    createCase: async (input): Promise<ModerationCaseEntity> =>
      retry(
        async () =>
          this.db.$transaction(async (tx) => {
            const aggregate = await tx.moderationCase.aggregate({
              where: { guildId: input.guildId },
              _max: { sequence: true },
            });
            const maxRow = aggregate['_max'] as { sequence?: number | null } | undefined;
            const sequence = (maxRow?.sequence ?? 0) + 1;
            const row = await tx.moderationCase.create({
              data: {
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
                previousState: stringifyJson(input.previousState ?? {}),
                newState: stringifyJson(input.newState ?? {}),
                durationMs: input.durationMs ?? null,
                expiresAt: input.expiresAt ?? null,
              },
            });
            return map.toCase(row);
          }),
        { attempts: 4, baseDelayMs: 25, retryOn: isUniqueViolation },
      ),
    getCase: async (guildId, caseId) => {
      const row = await this.db.moderationCase.findFirst({
        where: { guildId, OR: [{ caseId }, { id: caseId }] },
      });
      return row ? map.toCase(row) : null;
    },
    listCases: async (guildId, query) => {
      const { skip, take, page, pageSize } = pageArgs(query);
      const where = clean({
        guildId, targetId: query?.targetId, moderatorId: query?.moderatorId, action: query?.action,
      });
      const [rows, total] = await Promise.all([
        this.db.moderationCase.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
        this.db.moderationCase.count({ where }),
      ]);
      return { items: rows.map(map.toCase), total, page, pageSize };
    },
    updateCase: async (id, patch) => {
      await this.db.moderationCase.update({ where: { id }, data: clean({ ...patch }) });
    },
    listExpiredCases: async (now, limit = 100) => {
      const rows = await this.db.moderationCase.findMany({
        where: { active: true, expiresAt: { lte: now, not: null } },
        take: limit,
        orderBy: { expiresAt: 'asc' },
      });
      return rows.map(map.toCase);
    },
    addWarning: async (input): Promise<WarningEntity> => {
      const row = await this.db.warning.create({
        data: {
          guildId: input.guildId,
          caseRef: input.caseRef ?? null,
          targetId: input.targetId,
          moderatorId: input.moderatorId,
          reason: input.reason,
          points: input.points ?? 1,
          expiresAt: input.expiresAt ?? null,
        },
      });
      return map.toWarning(row);
    },
    listWarnings: async (guildId, targetId, activeOnly = true) => {
      const rows = await this.db.warning.findMany({
        where: clean({ guildId, targetId, active: activeOnly ? true : undefined }),
        orderBy: { createdAt: 'desc' },
      });
      return rows.map(map.toWarning);
    },
    deactivateWarning: async (id) => {
      const result = await this.db.warning.updateMany({ where: { id, active: true }, data: { active: false } });
      return result.count > 0;
    },
    expireWarnings: async (now) => {
      const result = await this.db.warning.updateMany({
        where: { active: true, expiresAt: { lte: now, not: null } },
        data: { active: false },
      });
      return result.count;
    },
  };

  // ============================================================ Security
  security: P.SecurityRepository = {
    createIncident: async (input): Promise<SecurityIncidentEntity> => {
      const row = await this.db.securityIncident.create({
        data: clean({
          guildId: input.guildId,
          kind: input.kind,
          severity: input.severity,
          status: input.status,
          title: input.title,
          description: input.description,
          actorId: input.actorId,
          actorType: input.actorType,
          robloxGameId: input.robloxGameId,
          evidence: stringifyJson(input.evidence),
          actionsTaken: stringifyJson(input.actionsTaken),
        }),
      });
      return map.toIncident(row);
    },
    listIncidents: async (query) => {
      const { skip, take, page, pageSize } = pageArgs(query);
      const where = clean({ guildId: query?.guildId, status: query?.status, severity: query?.severity });
      const [rows, total] = await Promise.all([
        this.db.securityIncident.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
        this.db.securityIncident.count({ where }),
      ]);
      return { items: rows.map(map.toIncident), total, page, pageSize };
    },
    getIncident: async (id) => {
      const row = await this.db.securityIncident.findUnique({ where: { id } });
      return row ? map.toIncident(row) : null;
    },
    updateIncident: async (id, patch) => {
      await this.db.securityIncident.update({
        where: { id },
        data: clean({
          status: patch.status,
          severity: patch.severity,
          acknowledgedBy: patch.acknowledgedBy,
          acknowledgedAt: patch.acknowledgedBy ? new Date() : undefined,
          resolvedBy: patch.resolvedBy,
          resolvedAt: patch.resolvedBy ? new Date() : undefined,
          actionsTaken: patch.actionsTaken ? stringifyJson(patch.actionsTaken) : undefined,
        }),
      });
    },
  };

  audit: P.AuditRepository = {
    log: async (input): Promise<AuditLogEntity> => {
      const row = await this.db.auditLog.create({
        data: clean({
          guildId: input.guildId,
          actorId: input.actorId,
          actorType: input.actorType,
          action: input.action,
          targetId: input.targetId,
          targetType: input.targetType,
          result: input.result,
          reason: input.reason,
          metadata: stringifyJson(input.metadata),
        }),
      });
      return map.toAudit(row);
    },
    list: async (query) => {
      const { skip, take, page, pageSize } = pageArgs(query);
      const where = clean({
        guildId: query?.guildId,
        actorId: query?.actorId,
        action: query?.action ? { startsWith: query.action } : undefined,
      });
      const [rows, total] = await Promise.all([
        this.db.auditLog.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
        this.db.auditLog.count({ where }),
      ]);
      return { items: rows.map(map.toAudit), total, page, pageSize };
    },
  };

  // ============================================================= Tickets
  tickets: P.TicketRepository = {
    create: async (input): Promise<TicketEntity> =>
      retry(
        async () =>
          this.db.$transaction(async (tx) => {
            const aggregate = await tx.ticket.aggregate({
              where: { guildId: input.guildId }, _max: { number: true },
            });
            const maxRow = aggregate['_max'] as { number?: number | null } | undefined;
            const number = (maxRow?.number ?? 0) + 1;
            const row = await tx.ticket.create({
              data: clean({
                guildId: input.guildId,
                panelId: input.panelId,
                number,
                channelId: input.channelId,
                openerId: input.openerId,
                category: input.category,
                subject: input.subject,
                formData: stringifyJson(input.formData ?? {}),
              }),
            });
            return map.toTicket(row);
          }),
        { attempts: 4, baseDelayMs: 25, retryOn: isUniqueViolation },
      ),
    findByChannel: async (channelId) => {
      const row = await this.db.ticket.findUnique({ where: { channelId } });
      return row ? map.toTicket(row) : null;
    },
    findByNumber: async (guildId, number) => {
      const row = await this.db.ticket.findUnique({ where: { guildId_number: { guildId, number } } });
      return row ? map.toTicket(row) : null;
    },
    list: async (guildId, query) => {
      const { skip, take, page, pageSize } = pageArgs(query);
      const where = clean({ guildId, status: query?.status, openerId: query?.openerId });
      const [rows, total] = await Promise.all([
        this.db.ticket.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
        this.db.ticket.count({ where }),
      ]);
      return { items: rows.map(map.toTicket), total, page, pageSize };
    },
    update: async (id, patch): Promise<TicketEntity> => {
      const row = await this.db.ticket.update({
        where: { id },
        data: clean({
          status: patch.status,
          claimedById: patch.claimedById,
          claimedAt: patch.claimedById ? new Date() : undefined,
          closedById: patch.closedById,
          closedAt: patch.closedAt,
          closeReason: patch.closeReason,
          reopenCount: patch.reopenCount,
          rating: patch.rating,
          subject: patch.subject,
          transcriptUrl: patch.transcriptUrl,
        }),
      });
      return map.toTicket(row);
    },
    addMessage: async (input) => {
      await this.db.ticketMessage.create({
        data: {
          ticketId: input.ticketId,
          messageId: input.messageId,
          authorId: input.authorId,
          authorTag: input.authorTag,
          content: input.content,
          attachments: stringifyJson(input.attachments),
          isStaff: input.isStaff,
        },
      });
    },
    listMessages: async (ticketId): Promise<TicketMessageEntity[]> => {
      const rows = await this.db.ticketMessage.findMany({
        where: { ticketId }, orderBy: { createdAt: 'asc' }, take: 5_000,
      });
      return rows.map(map.toTicketMessage);
    },
    countOpenByUser: async (guildId, userId) =>
      this.db.ticket.count({ where: { guildId, openerId: userId, status: { in: ['OPEN', 'CLAIMED', 'LOCKED'] } } }),
  };

  // ============================================================== Levels
  levels: P.LevelRepository = {
    getProfile: async (guildId, userId): Promise<XPProfileEntity> => {
      const row = await this.db.xPProfile.findUnique({ where: { guildId_userId: { guildId, userId } } });
      return row ? map.toXp(row) : emptyXpProfile(guildId, userId);
    },
    /** Atomar: increment auf DB-Ebene, danach Levelberechnung im selben Vorgang. */
    addXp: async (guildId, userId, amount) =>
      this.db.$transaction(async (tx) => {
        const existing = await tx.xPProfile.findUnique({ where: { guildId_userId: { guildId, userId } } });
        const current = existing ? map.toXp(existing) : emptyXpProfile(guildId, userId);
        const previousLevel = current.level;
        const totalXp = Math.max(0, current.totalXp + amount);
        const { level, xpIntoLevel } = levelFromTotalXp(totalXp);
        const data = {
          xp: xpIntoLevel,
          level,
          totalXp,
          messages: current.messages + (amount > 0 ? 1 : 0),
          lastXpAt: new Date(),
        };
        const row = await tx.xPProfile.upsert({
          where: { guildId_userId: { guildId, userId } },
          create: { guildId, userId, ...data },
          update: data,
        });
        return { profile: map.toXp(row), leveledUp: level > previousLevel, previousLevel };
      }),
    setLevel: async (guildId, userId, level): Promise<XPProfileEntity> => {
      const totalXp = totalXpForLevel(level);
      const data = { level, xp: 0, totalXp };
      const row = await this.db.xPProfile.upsert({
        where: { guildId_userId: { guildId, userId } },
        create: { guildId, userId, ...data },
        update: data,
      });
      return map.toXp(row);
    },
    leaderboard: async (guildId, limit = 10, offset = 0) => {
      const rows = await this.db.xPProfile.findMany({
        where: { guildId }, orderBy: { totalXp: 'desc' }, take: limit, skip: offset,
      });
      return rows.map((row, index) => ({ ...map.toXp(row), rank: offset + index + 1 }));
    },
    rankOf: async (guildId, userId) => {
      const profile = await this.db.xPProfile.findUnique({ where: { guildId_userId: { guildId, userId } } });
      if (!profile) return 0;
      const better = await this.db.xPProfile.count({
        where: { guildId, totalXp: { gt: Number(profile['totalXp'] ?? 0) } },
      });
      return better + 1;
    },
    listRewards: async (guildId) => {
      const rows = await this.db.levelReward.findMany({ where: { guildId }, orderBy: { level: 'asc' } });
      return rows.map((row) => ({
        level: Number(row['level'] ?? 0),
        roleId: (row['roleId'] as string | null) ?? null,
        coins: Number(row['coins'] ?? 0),
        removePrevious: Boolean(row['removePrevious']),
      }));
    },
  };

  // ============================================================= Economy
  economy: P.EconomyRepository = {
    getProfile: async (guildId, userId): Promise<EconomyProfileEntity> => {
      const row = await this.db.economyProfile.upsert({
        where: { guildId_userId: { guildId, userId } },
        create: { guildId, userId },
        update: {},
      });
      return map.toEconomy(row);
    },
    /**
     * Atomare Buchung.
     * 1. Idempotenz ueber den Unique-Index auf `Transaction.idempotencyKey`.
     * 2. Bedingtes Update (`updateMany` mit Guard auf Saldo und `version`):
     *    schlaegt es fehl, war das Guthaben zwischenzeitlich zu niedrig.
     */
    mutate: async (mutation) =>
      this.db.$transaction(async (tx) => {
        if (mutation.idempotencyKey) {
          const existing = await tx.transaction.findUnique({
            where: { idempotencyKey: mutation.idempotencyKey },
          });
          if (existing) {
            const profileRow = await tx.economyProfile.findUnique({
              where: { guildId_userId: { guildId: mutation.guildId, userId: mutation.userId } },
            });
            return {
              profile: profileRow ? map.toEconomy(profileRow) : await this.economy.getProfile(mutation.guildId, mutation.userId),
              transaction: map.toTransaction(existing),
            };
          }
        }

        const currentRow = await tx.economyProfile.upsert({
          where: { guildId_userId: { guildId: mutation.guildId, userId: mutation.userId } },
          create: { guildId: mutation.guildId, userId: mutation.userId },
          update: {},
        });
        const current = map.toEconomy(currentRow);
        const next = current[mutation.target] + mutation.amount;
        if (next < 0 && !mutation.allowNegative) {
          throw new PreconditionError('Nicht genuegend Guthaben', {
            required: Math.abs(mutation.amount), available: current[mutation.target],
          });
        }
        if (mutation.target === 'bank' && next > current.bankCapacity) {
          throw new PreconditionError('Bank-Kapazitaet ueberschritten', { capacity: current.bankCapacity });
        }

        const updateResult = await tx.economyProfile.updateMany({
          where: { id: current.id, version: current.version },
          data: {
            [mutation.target]: next,
            version: { increment: 1 },
            totalEarned: mutation.amount > 0 ? { increment: mutation.amount } : undefined,
            totalSpent: mutation.amount < 0 ? { increment: -mutation.amount } : undefined,
          },
        });
        if (updateResult.count === 0) {
          throw new ConflictError('Konkurrierende Buchung erkannt — bitte erneut versuchen');
        }

        const balanceAfter = mutation.target === 'wallet' ? next + current.bank : current.wallet + next;
        const transactionRow = await tx.transaction.create({
          data: clean({
            guildId: mutation.guildId,
            userId: mutation.userId,
            type: mutation.type,
            amount: mutation.amount,
            balanceAfter,
            counterpartyId: mutation.counterpartyId,
            reason: mutation.reason,
            idempotencyKey: mutation.idempotencyKey,
          }),
        });

        return {
          profile: { ...current, [mutation.target]: next, version: current.version + 1 },
          transaction: map.toTransaction(transactionRow),
        };
      }),
    transfer: async ({ guildId, fromUserId, toUserId, amount, reason, idempotencyKey }) => {
      if (amount <= 0) throw new PreconditionError('Betrag muss positiv sein');
      if (fromUserId === toUserId) throw new PreconditionError('Selbsttransfer ist nicht moeglich');

      return this.db.$transaction(async (tx) => {
        if (idempotencyKey) {
          const existing = await tx.transaction.findUnique({ where: { idempotencyKey } });
          if (existing) {
            const [fromRow, toRow] = await Promise.all([
              tx.economyProfile.findUnique({ where: { guildId_userId: { guildId, userId: fromUserId } } }),
              tx.economyProfile.findUnique({ where: { guildId_userId: { guildId, userId: toUserId } } }),
            ]);
            if (!fromRow || !toRow) throw new NotFoundError('Economy-Profil');
            return { from: map.toEconomy(fromRow), to: map.toEconomy(toRow) };
          }
        }

        const fromRow = await tx.economyProfile.upsert({
          where: { guildId_userId: { guildId, userId: fromUserId } },
          create: { guildId, userId: fromUserId },
          update: {},
        });
        const from = map.toEconomy(fromRow);
        // Bedingtes Update: das Guthaben wird in derselben Anweisung geprueft.
        const debit = await tx.economyProfile.updateMany({
          where: { id: from.id, wallet: { gte: amount }, version: from.version },
          data: { wallet: { decrement: amount }, totalSpent: { increment: amount }, version: { increment: 1 } },
        });
        if (debit.count === 0) {
          throw new PreconditionError('Nicht genuegend Guthaben', { required: amount, available: from.wallet });
        }

        const toRow = await tx.economyProfile.upsert({
          where: { guildId_userId: { guildId, userId: toUserId } },
          create: { guildId, userId: toUserId, wallet: amount, totalEarned: amount },
          update: { wallet: { increment: amount }, totalEarned: { increment: amount }, version: { increment: 1 } },
        });

        await tx.transaction.createMany({
          data: [
            clean({
              guildId, userId: fromUserId, type: 'TRANSFER_OUT', amount: -amount,
              balanceAfter: from.wallet - amount + from.bank, counterpartyId: toUserId,
              reason, idempotencyKey,
            }),
            clean({
              guildId, userId: toUserId, type: 'TRANSFER_IN', amount,
              balanceAfter: map.toEconomy(toRow).wallet + map.toEconomy(toRow).bank,
              counterpartyId: fromUserId, reason,
            }),
          ],
        });

        return {
          from: { ...from, wallet: from.wallet - amount, version: from.version + 1 },
          to: map.toEconomy(toRow),
        };
      });
    },
    touchCooldown: async (guildId, userId, field, at, streakDays) => {
      await this.db.economyProfile.upsert({
        where: { guildId_userId: { guildId, userId } },
        create: clean({ guildId, userId, [field]: at, streakDays }),
        update: clean({ [field]: at, streakDays }),
      });
    },
    leaderboard: async (guildId, limit = 10) => {
      const rows = await this.db.economyProfile.findMany({
        where: { guildId }, orderBy: [{ wallet: 'desc' }, { bank: 'desc' }], take: limit,
      });
      return rows.map((row, index) => ({ ...map.toEconomy(row), rank: index + 1 }));
    },
    listTransactions: async (guildId, userId, limit = 20): Promise<TransactionEntity[]> => {
      const rows = await this.db.transaction.findMany({
        where: { guildId, userId }, orderBy: { createdAt: 'desc' }, take: limit,
      });
      return rows.map(map.toTransaction);
    },
    listItems: async (guildId, enabledOnly = true): Promise<ItemEntity[]> => {
      const rows = await this.db.item.findMany({
        where: clean({ guildId, enabled: enabledOnly ? true : undefined }), orderBy: { price: 'asc' },
      });
      return rows.map(map.toItem);
    },
    getItem: async (guildId, key) => {
      const row = await this.db.item.findUnique({ where: { guildId_key: { guildId, key } } });
      return row ? map.toItem(row) : null;
    },
    upsertItem: async (item): Promise<ItemEntity> => {
      const data = clean({
        name: item.name, description: item.description, emoji: item.emoji, price: item.price,
        sellPrice: item.sellPrice, kind: item.kind, roleId: item.roleId,
        payload: stringifyJson(item.payload), stock: item.stock, maxPerUser: item.maxPerUser,
        tradable: item.tradable, enabled: item.enabled,
      });
      const row = await this.db.item.upsert({
        where: { guildId_key: { guildId: item.guildId, key: item.key } },
        create: { guildId: item.guildId, key: item.key, ...data },
        update: data,
      });
      return map.toItem(row);
    },
    inventory: async (guildId, userId): Promise<InventoryEntryEntity[]> => {
      const profile = await this.db.economyProfile.findUnique({
        where: { guildId_userId: { guildId, userId } },
      });
      if (!profile) return [];
      const rows = await this.db.inventoryItem.findMany({
        where: { profileId: String(profile['id']), quantity: { gt: 0 } },
        include: { item: true },
      });
      return rows.map((row) => {
        const item = (row['item'] ?? {}) as Row;
        return {
          itemId: String(row['itemId']),
          itemKey: String(item['key'] ?? ''),
          name: String(item['name'] ?? ''),
          emoji: (item['emoji'] as string | null) ?? null,
          quantity: Number(row['quantity'] ?? 0),
          tradable: Boolean(item['tradable']),
        };
      });
    },
    addInventory: async (guildId, userId, itemId, quantity) => {
      await this.db.$transaction(async (tx) => {
        const profile = await tx.economyProfile.upsert({
          where: { guildId_userId: { guildId, userId } },
          create: { guildId, userId },
          update: {},
        });
        const profileId = String(profile['id']);
        if (quantity < 0) {
          const removed = await tx.inventoryItem.updateMany({
            where: { profileId, itemId, quantity: { gte: -quantity } },
            data: { quantity: { increment: quantity } },
          });
          if (removed.count === 0) throw new PreconditionError('Nicht genuegend Exemplare im Inventar');
          return;
        }
        await tx.inventoryItem.upsert({
          where: { profileId_itemId: { profileId, itemId } },
          create: { profileId, itemId, quantity },
          update: { quantity: { increment: quantity } },
        });
      });
    },
  };

  // ======================================================== Verification
  verification: P.VerificationRepository = {
    create: async (input): Promise<VerificationEntity> => {
      const row = await this.db.verification.create({
        data: clean({
          userId: input.userId,
          codeHash: input.codeHash,
          codeHint: input.codeHint,
          guildId: input.guildId,
          gameId: input.gameId,
          expiresAt: input.expiresAt,
        }),
      });
      return map.toVerification(row, input.discordId);
    },
    findActiveByHint: async (codeHint) => {
      const rows = await this.db.verification.findMany({
        where: { codeHint, status: 'PENDING', expiresAt: { gt: new Date() } },
        take: 10,
      });
      return rows.map((row) => map.toVerification(row, String(row['userId'])));
    },
    incrementAttempts: async (id) => {
      const row = await this.db.verification.update({
        where: { id }, data: { attempts: { increment: 1 } },
      });
      const attempts = Number(row['attempts'] ?? 0);
      if (attempts >= Number(row['maxAttempts'] ?? 5)) {
        await this.db.verification.update({ where: { id }, data: { status: 'REVOKED' } });
      }
      return attempts;
    },
    markVerified: async (id, robloxUserId) => {
      await this.db.verification.update({
        where: { id }, data: { status: 'VERIFIED', robloxUserId, usedAt: new Date() },
      });
    },
    invalidateForUser: async (userId) => {
      await this.db.verification.updateMany({
        where: { userId, status: 'PENDING' }, data: { status: 'REVOKED' },
      });
    },
    purgeExpired: async (now) => {
      const result = await this.db.verification.updateMany({
        where: { status: 'PENDING', expiresAt: { lte: now } }, data: { status: 'EXPIRED' },
      });
      return result.count;
    },
  };

  // ============================================================== Roblox
  roblox: P.RobloxRepository = {
    linkAccount: async (input): Promise<RobloxAccountEntity> => {
      const conflicting = await this.db.robloxAccount.findUnique({
        where: { robloxUserId: input.robloxUserId },
      });
      if (conflicting && String(conflicting['userId']) !== input.userId) {
        throw new ConflictError('Dieser Roblox-Account ist bereits mit einem anderen Discord-Konto verknuepft');
      }
      const existing = await this.db.robloxAccount.findUnique({ where: { userId: input.userId } });
      const previousUsername =
        existing && String(existing['username']) !== input.username ? String(existing['username']) : undefined;
      const data = clean({
        robloxUserId: input.robloxUserId,
        username: input.username,
        displayName: input.displayName,
        avatarUrl: input.avatarUrl,
        previousUsername,
        method: input.method ?? 'game',
        lastSyncedAt: new Date(),
        usernameCheckedAt: new Date(),
      });
      const row = await this.db.robloxAccount.upsert({
        where: { userId: input.userId },
        create: { userId: input.userId, ...data },
        update: data,
      });
      return map.toRobloxAccount(row, input.discordId);
    },
    unlinkAccount: async (userId) => {
      const result = await this.db.robloxAccount.deleteMany({ where: { userId } });
      return result.count > 0;
    },
    getAccountByUser: async (userId) => {
      const row = await this.db.robloxAccount.findUnique({ where: { userId } });
      return row ? map.toRobloxAccount(row, userId) : null;
    },
    getAccountByDiscordId: async (discordId) => {
      const row = await this.db.robloxAccount.findUnique({ where: { userId: discordId } });
      return row ? map.toRobloxAccount(row, discordId) : null;
    },
    getAccountByRobloxId: async (robloxUserId) => {
      const row = await this.db.robloxAccount.findUnique({ where: { robloxUserId } });
      return row ? map.toRobloxAccount(row, String(row['userId'])) : null;
    },
    updateAccountNames: async (id, username, displayName) => {
      const existing = await this.db.robloxAccount.findUnique({ where: { id } });
      if (!existing) return;
      await this.db.robloxAccount.update({
        where: { id },
        data: clean({
          username,
          displayName,
          previousUsername: String(existing['username']) !== username ? String(existing['username']) : undefined,
          usernameCheckedAt: new Date(),
          lastSyncedAt: new Date(),
        }),
      });
    },
    upsertGame: async (input): Promise<RobloxGameEntity> => {
      const data = clean({
        placeId: input.placeId,
        name: input.name,
        iconUrl: input.iconUrl,
        signingSecretHash: input.signingSecretHash,
        secretHint: input.secretHint,
        active: input.active,
        settings: stringifyJson(input.settings),
      });
      const row = await this.db.robloxGame.upsert({
        where: { guildId_universeId: { guildId: input.guildId, universeId: input.universeId } },
        create: { guildId: input.guildId, universeId: input.universeId, ...data },
        update: data,
      });
      return map.toGame(row);
    },
    listGames: async (guildId): Promise<RobloxGameEntity[]> => {
      const rows = await this.db.robloxGame.findMany({ where: clean({ guildId }) });
      return rows.map(map.toGame);
    },
    getGame: async (id) => {
      const row = await this.db.robloxGame.findUnique({ where: { id } });
      return row ? map.toGame(row) : null;
    },
    getGameByUniverse: async (universeId) => {
      const row = await this.db.robloxGame.findFirst({ where: { universeId } });
      return row ? map.toGame(row) : null;
    },
    recordHeartbeat: async (input): Promise<RobloxServerEntity> => {
      const data = clean({
        placeId: input.placeId,
        region: input.region,
        playerCount: input.playerCount,
        maxPlayers: input.maxPlayers,
        version: input.version,
        fps: input.fps,
        memoryMb: input.memoryMb,
        lastHeartbeatAt: input.lastHeartbeatAt,
        status: 'online',
        players: stringifyJson(input.players),
      });
      const row = await this.db.robloxServer.upsert({
        where: { gameId_jobId: { gameId: input.gameId, jobId: input.jobId } },
        create: { gameId: input.gameId, jobId: input.jobId, startedAt: input.startedAt ?? new Date(), ...data },
        update: data,
      });
      return map.toServer(row);
    },
    listServers: async (gameId): Promise<RobloxServerEntity[]> => {
      const rows = await this.db.robloxServer.findMany({
        where: clean({ gameId }), orderBy: { lastHeartbeatAt: 'desc' }, take: 500,
      });
      return rows.map(map.toServer);
    },
    markStaleServers: async (threshold) => {
      const result = await this.db.robloxServer.updateMany({
        where: { status: 'online', lastHeartbeatAt: { lt: threshold } },
        data: { status: 'stale' },
      });
      return result.count;
    },
    /** Idempotent ueber den Unique-Index auf `eventId`. */
    recordEvent: async (input): Promise<{ event: RobloxEventEntity; duplicate: boolean }> => {
      try {
        const row = await this.db.robloxEvent.create({
          data: clean({
            gameId: input.gameId,
            eventId: input.eventId,
            type: input.type,
            jobId: input.jobId,
            robloxUserId: input.robloxUserId,
            payload: stringifyJson(input.payload),
            occurredAt: input.occurredAt,
          }),
        });
        await this.db.robloxGame.update({
          where: { id: input.gameId }, data: { lastEventAt: new Date() },
        }).catch(() => undefined);
        return { event: map.toEvent(row), duplicate: false };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const existing = await this.db.robloxEvent.findUnique({ where: { eventId: input.eventId } });
        if (!existing) throw error;
        return { event: map.toEvent(existing), duplicate: true };
      }
    },
    markEventProcessed: async (id, error) => {
      await this.db.robloxEvent.update({
        where: { id }, data: clean({ processedAt: new Date(), error: error ?? null }),
      });
    },
    listEvents: async (query) => {
      const { skip, take, page, pageSize } = pageArgs(query);
      const where = clean({ gameId: query.gameId, type: query.type });
      const [rows, total] = await Promise.all([
        this.db.robloxEvent.findMany({ where, skip, take, orderBy: { occurredAt: 'desc' } }),
        this.db.robloxEvent.count({ where }),
      ]);
      return { items: rows.map(map.toEvent), total, page, pageSize };
    },
    listEventRoutes: async (guildId, eventType) => {
      const rows = await this.db.robloxEventRoute.findMany({
        where: { guildId, eventType, enabled: true },
      });
      return rows.map((row) => ({
        channelId: String(row['channelId']),
        gameId: (row['gameId'] as string | null) ?? null,
        filter: JSON.parse(String(row['filter'] ?? '{}')) as Record<string, unknown>,
      }));
    },
    upsertEventRoute: async (input) => {
      await this.db.robloxEventRoute.upsert({
        where: {
          guildId_gameId_eventType_channelId: {
            guildId: input.guildId, gameId: input.gameId, eventType: input.eventType, channelId: input.channelId,
          },
        },
        create: { ...input },
        update: { enabled: input.enabled },
      });
    },
    queueCommand: async (input): Promise<RobloxCommandEntity> => {
      const row = await this.db.robloxCommand.create({
        data: clean({
          gameId: input.gameId,
          type: input.type,
          jobId: input.jobId,
          payload: stringifyJson(input.payload),
          issuedById: input.issuedById,
          guildId: input.guildId,
          confirmedById: input.confirmedById,
          expiresAt: input.expiresAt,
        }),
      });
      return map.toCommand(row);
    },
    /** Holt und markiert in einer Transaktion — kein Kommando wird doppelt geliefert. */
    claimCommands: async (gameId, jobId, limit = 10): Promise<RobloxCommandEntity[]> =>
      this.db.$transaction(async (tx) => {
        const now = new Date();
        const candidates = await tx.robloxCommand.findMany({
          where: {
            gameId, status: 'PENDING', expiresAt: { gt: now },
            OR: [{ jobId: null }, { jobId }],
          },
          orderBy: { createdAt: 'asc' },
          take: limit,
        });
        if (candidates.length === 0) return [];
        const ids = candidates.map((row) => String(row['id']));
        const claimed = await tx.robloxCommand.updateMany({
          where: { id: { in: ids }, status: 'PENDING' },
          data: { status: 'DELIVERED', deliveredAt: now },
        });
        if (claimed.count === 0) return [];
        const rows = await tx.robloxCommand.findMany({ where: { id: { in: ids }, status: 'DELIVERED' } });
        return rows.map(map.toCommand);
      }),
    acknowledgeCommand: async (id, result) => {
      await this.db.robloxCommand.update({
        where: { id },
        data: clean({
          status: result.ok ? 'ACKNOWLEDGED' : 'FAILED',
          acknowledgedAt: new Date(),
          result: result.message,
          error: result.ok ? null : result.message ?? 'unbekannter Fehler',
        }),
      });
    },
    expireCommands: async (now) => {
      const result = await this.db.robloxCommand.updateMany({
        where: { status: { in: ['PENDING', 'DELIVERED'] }, expiresAt: { lte: now } },
        data: { status: 'EXPIRED' },
      });
      return result.count;
    },
    listGroups: async (guildId): Promise<RobloxGroupEntity[]> => {
      const rows = await this.db.robloxGroup.findMany({ where: { guildId } });
      return rows.map(map.toGroup);
    },
    upsertGroup: async (input): Promise<RobloxGroupEntity> => {
      const data = clean({
        name: input.name,
        syncEnabled: input.syncEnabled,
        removeOnLeave: input.removeOnLeave,
        rankMapping: stringifyJson(input.rankMapping),
      });
      const row = await this.db.robloxGroup.upsert({
        where: { guildId_groupId: { guildId: input.guildId, groupId: input.groupId } },
        create: { guildId: input.guildId, groupId: input.groupId, ...data },
        update: data,
      });
      return map.toGroup(row);
    },
    setGroupSynced: async (id, at) => {
      await this.db.robloxGroup.update({ where: { id }, data: { lastSyncAt: at } });
    },
    startSession: async ({ gameId, robloxUserId, jobId, accountId }) => {
      await this.db.robloxSession.create({
        data: clean({ gameId, robloxUserId, jobId, accountId }),
      });
    },
    endSession: async (gameId, robloxUserId, at) => {
      const row = await this.db.robloxSession.findFirst({
        where: { gameId, robloxUserId, leftAt: null }, orderBy: { joinedAt: 'desc' },
      });
      if (!row) return null;
      const joinedAt = new Date(row['joinedAt'] as string);
      const durationSeconds = Math.max(0, Math.round((at.getTime() - joinedAt.getTime()) / 1000));
      await this.db.robloxSession.update({
        where: { id: String(row['id']) }, data: { leftAt: at, durationSeconds },
      });
      return durationSeconds;
    },
  };

  // ============================================================= Rewards
  rewards: P.RewardRepository = {
    /** Idempotent: der Unique-Index auf `idempotencyKey` ist die Absicherung. */
    grant: async (input): Promise<{ grant: RewardGrantEntity; created: boolean }> => {
      try {
        const row = await this.db.rewardGrant.create({
          data: clean({
            userId: input.userId,
            guildId: input.guildId,
            idempotencyKey: input.idempotencyKey,
            kind: input.kind,
            amount: input.amount,
            reference: input.reference,
            status: input.status ?? 'PENDING',
            source: input.source,
          }),
        });
        return { grant: map.toRewardGrant(row), created: true };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const existing = await this.db.rewardGrant.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (!existing) throw error;
        return { grant: map.toRewardGrant(existing), created: false };
      }
    },
    markGranted: async (id, error) => {
      await this.db.rewardGrant.update({
        where: { id },
        data: clean({ status: error ? 'FAILED' : 'GRANTED', error, grantedAt: error ? undefined : new Date() }),
      });
    },
    listForUser: async (userId, limit = 25): Promise<RewardGrantEntity[]> => {
      const rows = await this.db.rewardGrant.findMany({
        where: { userId }, orderBy: { createdAt: 'desc' }, take: limit,
      });
      return rows.map(map.toRewardGrant);
    },
  };

  achievements: P.AchievementRepository = {
    list: async (guildId): Promise<AchievementEntity[]> => {
      const rows = await this.db.achievement.findMany({ where: { guildId } });
      return rows.map(map.toAchievement);
    },
    get: async (guildId, key) => {
      const row = await this.db.achievement.findUnique({ where: { guildId_key: { guildId, key } } });
      return row ? map.toAchievement(row) : null;
    },
    upsert: async (input): Promise<AchievementEntity> => {
      const data = clean({
        name: input.name, description: input.description, rarity: input.rarity, icon: input.icon,
        hidden: input.hidden, origin: input.origin, rewards: stringifyJson(input.rewards),
        condition: stringifyJson(input.condition), enabled: input.enabled,
      });
      const row = await this.db.achievement.upsert({
        where: { guildId_key: { guildId: input.guildId, key: input.key } },
        create: { guildId: input.guildId, key: input.key, ...data },
        update: data,
      });
      return map.toAchievement(row);
    },
    unlock: async (achievementId, userId, guildId) => {
      try {
        await this.db.userAchievement.create({ data: { achievementId, userId, guildId } });
        return true;
      } catch (error) {
        if (isUniqueViolation(error)) return false;
        throw error;
      }
    },
    listUnlocked: async (userId, guildId) => {
      const rows = await this.db.userAchievement.findMany({ where: { userId, guildId } });
      return rows.map((row) => String(row['achievementId']));
    },
  };

  promos: P.PromoRepository = {
    create: async (input): Promise<PromoCodeEntity> => {
      const row = await this.db.promoCode.create({
        data: clean({
          guildId: input.guildId,
          code: input.code.toUpperCase(),
          reward: stringifyJson(input.reward),
          maxUses: input.maxUses,
          perUserLimit: input.perUserLimit,
          gameId: input.gameId,
          expiresAt: input.expiresAt,
          enabled: input.enabled,
          createdById: input.createdById,
        }),
      });
      return map.toPromo(row);
    },
    list: async (guildId): Promise<PromoCodeEntity[]> => {
      const rows = await this.db.promoCode.findMany({ where: { guildId }, orderBy: { createdAt: 'desc' } });
      return rows.map(map.toPromo);
    },
    findByCode: async (guildId, code) => {
      const row = await this.db.promoCode.findUnique({
        where: { guildId_code: { guildId, code: code.toUpperCase() } },
      });
      return row ? map.toPromo(row) : null;
    },
    delete: async (guildId, code) => {
      const result = await this.db.promoCode.deleteMany({ where: { guildId, code: code.toUpperCase() } });
      return result.count > 0;
    },
    /** Atomar: Limits pruefen und Einloesung registrieren. */
    redeem: async (codeId, userId) =>
      this.db.$transaction(async (tx) => {
        const row = await tx.promoCode.findUnique({ where: { id: codeId } });
        if (!row || row['enabled'] !== true) return { ok: false, reason: 'DISABLED' };
        const promo = map.toPromo(row);
        if (promo.expiresAt && promo.expiresAt <= new Date()) return { ok: false, reason: 'EXPIRED' };

        const userUses = await tx.promoRedemption.count({ where: { codeId, userId } });
        if (userUses >= promo.perUserLimit) return { ok: false, reason: 'USER_LIMIT' };

        const consumed = await tx.promoCode.updateMany({
          where: promo.maxUses >= 0 ? { id: codeId, uses: { lt: promo.maxUses } } : { id: codeId },
          data: { uses: { increment: 1 } },
        });
        if (consumed.count === 0) return { ok: false, reason: 'EXHAUSTED' };

        try {
          await tx.promoRedemption.create({ data: { codeId, userId } });
        } catch (error) {
          if (isUniqueViolation(error)) return { ok: false, reason: 'USER_LIMIT' };
          throw error;
        }
        return { ok: true };
      }),
  };

  giveaways: P.GiveawayRepository = {
    create: async (input): Promise<GiveawayEntity> => {
      const row = await this.db.giveaway.create({
        data: clean({
          guildId: input.guildId,
          channelId: input.channelId,
          messageId: input.messageId,
          hostId: input.hostId,
          prize: input.prize,
          description: input.description,
          winnerCount: input.winnerCount,
          endsAt: input.endsAt,
          requirements: stringifyJson(input.requirements),
        }),
      });
      return map.toGiveaway(row);
    },
    get: async (id) => {
      const row = await this.db.giveaway.findUnique({ where: { id } });
      return row ? map.toGiveaway(row) : null;
    },
    findByMessage: async (messageId) => {
      const row = await this.db.giveaway.findFirst({ where: { messageId } });
      return row ? map.toGiveaway(row) : null;
    },
    list: async (guildId, endedOnly): Promise<GiveawayEntity[]> => {
      const rows = await this.db.giveaway.findMany({
        where: clean({ guildId, ended: endedOnly }), orderBy: { endsAt: 'desc' }, take: 100,
      });
      return rows.map(map.toGiveaway);
    },
    /**
     * Teilnahme. Die Eintraege liegen als JSON-Liste vor; der Schreibvorgang
     * laeuft in einer Transaktion, um Verluste bei Parallelzugriff zu vermeiden.
     */
    addEntry: async (id, userId) =>
      this.db.$transaction(async (tx) => {
        const row = await tx.giveaway.findUnique({ where: { id } });
        if (!row) throw new NotFoundError('Giveaway');
        const entries = JSON.parse(String(row['entries'] ?? '[]')) as string[];
        if (entries.includes(userId)) return { added: false, total: entries.length };
        entries.push(userId);
        await tx.giveaway.update({ where: { id }, data: { entries: stringifyJson(entries) } });
        return { added: true, total: entries.length };
      }),
    removeEntry: async (id, userId) => {
      await this.db.$transaction(async (tx) => {
        const row = await tx.giveaway.findUnique({ where: { id } });
        if (!row) return;
        const entries = (JSON.parse(String(row['entries'] ?? '[]')) as string[]).filter((entry) => entry !== userId);
        await tx.giveaway.update({ where: { id }, data: { entries: stringifyJson(entries) } });
      });
    },
    setMessage: async (id, messageId) => {
      await this.db.giveaway.update({ where: { id }, data: { messageId } });
    },
    finish: async (id, winners): Promise<GiveawayEntity> => {
      const row = await this.db.giveaway.update({
        where: { id }, data: { ended: true, winners: stringifyJson(winners) },
      });
      return map.toGiveaway(row);
    },
    listDue: async (now): Promise<GiveawayEntity[]> => {
      const rows = await this.db.giveaway.findMany({ where: { ended: false, endsAt: { lte: now } }, take: 100 });
      return rows.map(map.toGiveaway);
    },
  };

  automations: P.AutomationRepository = {
    list: async (guildId, trigger): Promise<AutomationEntity[]> => {
      const rows = await this.db.automation.findMany({ where: clean({ guildId, trigger, enabled: true }) });
      return rows.map(map.toAutomation);
    },
    get: async (id) => {
      const row = await this.db.automation.findUnique({ where: { id } });
      return row ? map.toAutomation(row) : null;
    },
    create: async (input): Promise<AutomationEntity> => {
      const row = await this.db.automation.create({
        data: clean({
          guildId: input.guildId,
          name: input.name,
          description: input.description,
          enabled: input.enabled,
          trigger: input.trigger,
          schedule: input.schedule,
          conditions: stringifyJson(input.conditions),
          actions: stringifyJson(input.actions),
          rateLimitPerHour: input.rateLimitPerHour,
          createdById: 'system',
        }),
      });
      return map.toAutomation(row);
    },
    update: async (id, patch) => {
      await this.db.automation.update({
        where: { id },
        data: clean({
          name: patch.name,
          description: patch.description,
          enabled: patch.enabled,
          trigger: patch.trigger,
          schedule: patch.schedule,
          conditions: patch.conditions ? stringifyJson(patch.conditions) : undefined,
          actions: patch.actions ? stringifyJson(patch.actions) : undefined,
          rateLimitPerHour: patch.rateLimitPerHour,
        }),
      });
    },
    delete: async (id) => {
      const result = await this.db.automation.deleteMany({ where: { id } });
      return result.count > 0;
    },
    recordRun: async (id, status, trace, durationMs) => {
      await this.db.$transaction(async (tx) => {
        await tx.automationRun.create({
          data: { automationId: id, status, trace: stringifyJson(trace), durationMs },
        });
        await tx.automation.update({
          where: { id },
          data: clean({
            runCount: { increment: 1 },
            errorCount: status === 'FAILED' ? { increment: 1 } : undefined,
            lastRunAt: new Date(),
            lastError: status === 'FAILED' ? String(trace['error'] ?? 'unbekannt') : undefined,
          }),
        });
      });
    },
  };

  backups: P.BackupRepository = {
    create: async (input): Promise<BackupEntity> => {
      const serialized = JSON.stringify(input.payload);
      const { createHash } = await import('node:crypto');
      const checksum = createHash('sha256').update(serialized).digest('hex');
      const row = await this.db.backup.create({
        data: {
          guildId: input.guildId,
          name: input.name,
          createdById: input.createdById,
          payload: serialized,
          summary: stringifyJson(input.summary),
          sizeBytes: Buffer.byteLength(serialized, 'utf8'),
          checksum,
        },
      });
      return map.toBackup(row);
    },
    list: async (guildId): Promise<BackupEntity[]> => {
      const rows = await this.db.backup.findMany({
        where: { guildId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, guildId: true, name: true, createdById: true, summary: true,
          sizeBytes: true, checksum: true, restoredAt: true, createdAt: true,
        },
      });
      return rows.map(map.toBackup);
    },
    get: async (guildId, id) => {
      const row = await this.db.backup.findFirst({ where: { id, guildId } });
      if (!row) return null;
      return { ...map.toBackup(row), payload: JSON.parse(String(row['payload'] ?? '{}')) as unknown };
    },
    delete: async (guildId, id) => {
      const result = await this.db.backup.deleteMany({ where: { id, guildId } });
      return result.count > 0;
    },
    markRestored: async (id, userId) => {
      await this.db.backup.update({ where: { id }, data: { restoredAt: new Date(), restoredBy: userId } });
    },
    count: async (guildId) => this.db.backup.count({ where: { guildId } }),
  };

  apiKeys: P.ApiKeyRepository = {
    create: async (input): Promise<ApiKeyEntity> => {
      const row = await this.db.apiKey.create({
        data: clean({
          guildId: input.guildId,
          ownerId: input.ownerId,
          name: input.name,
          keyHash: input.keyHash,
          prefix: input.prefix,
          last4: input.last4,
          scopes: stringifyJson(input.scopes),
          rateLimitPerMinute: input.rateLimitPerMinute,
          environment: input.environment,
          expiresAt: input.expiresAt,
        }),
      });
      return map.toApiKey(row);
    },
    findByHash: async (hash) => {
      const row = await this.db.apiKey.findUnique({ where: { keyHash: hash } });
      if (!row || row['revokedAt'] != null) return null;
      return map.toApiKey(row);
    },
    list: async (guildId): Promise<ApiKeyEntity[]> => {
      const rows = await this.db.apiKey.findMany({ where: { guildId }, orderBy: { createdAt: 'desc' } });
      return rows.map(map.toApiKey);
    },
    revoke: async (id) => {
      await this.db.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    },
    recordUsage: async (id, entry) => {
      // Fire-and-forget-Charakter: Logging darf den Request nicht blockieren.
      await Promise.all([
        this.db.apiKey.update({
          where: { id }, data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
        }).catch(() => undefined),
        this.db.apiRequestLog.create({ data: clean({ apiKeyId: id, ...entry }) }).catch(() => undefined),
      ]);
    },
    listRequests: async (apiKeyId, limit = 50) => {
      const rows = await this.db.apiRequestLog.findMany({
        where: { apiKeyId }, orderBy: { createdAt: 'desc' }, take: limit,
      });
      return rows.map((row) => ({
        method: String(row['method']),
        path: String(row['path']),
        statusCode: Number(row['statusCode']),
        durationMs: Number(row['durationMs']),
        createdAt: new Date(row['createdAt'] as string),
      }));
    },
  };

  notifications: P.NotificationRepository = {
    create: async (input): Promise<NotificationEntity> => {
      const row = await this.db.notification.create({
        data: clean({
          guildId: input.guildId,
          userId: input.userId,
          category: input.category,
          severity: input.severity,
          title: input.title,
          body: input.body,
          link: input.link,
        }),
      });
      return map.toNotification(row);
    },
    list: async ({ guildId, userId, unreadOnly, limit = 50 }): Promise<NotificationEntity[]> => {
      const rows = await this.db.notification.findMany({
        where: clean({ guildId, userId, read: unreadOnly ? false : undefined }),
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      return rows.map(map.toNotification);
    },
    markRead: async (id) => {
      await this.db.notification.update({ where: { id }, data: { read: true, readAt: new Date() } });
    },
  };

  analytics: P.AnalyticsRepository = {
    record: async (snapshot) => {
      const data = { metrics: stringifyJson(snapshot.metrics) };
      await this.db.analyticsSnapshot.upsert({
        where: {
          guildId_scope_granularity_bucket: {
            guildId: snapshot.guildId, scope: snapshot.scope,
            granularity: snapshot.granularity, bucket: snapshot.bucket,
          },
        },
        create: {
          guildId: snapshot.guildId, scope: snapshot.scope,
          granularity: snapshot.granularity, bucket: snapshot.bucket, ...data,
        },
        update: data,
      });
    },
    query: async (guildId, scope, from, to, granularity = 'day'): Promise<AnalyticsSnapshotEntity[]> => {
      const rows = await this.db.analyticsSnapshot.findMany({
        where: { guildId, scope, granularity, bucket: { gte: from, lte: to } },
        orderBy: { bucket: 'asc' },
      });
      return rows.map(map.toAnalytics);
    },
    summary: async (guildId) => {
      const [guild, cases, openTickets, openIncidents, verified, servers] = await Promise.all([
        this.db.guild.findUnique({ where: { id: guildId } }),
        this.db.moderationCase.count({ where: { guildId } }),
        this.db.ticket.count({ where: { guildId, status: { in: ['OPEN', 'CLAIMED', 'LOCKED'] } } }),
        this.db.securityIncident.count({ where: { guildId, status: 'OPEN' } }),
        this.db.guildMember.count({ where: { guildId, left: false } }),
        this.db.robloxServer.count({ where: { status: 'online' } }),
      ]);
      return {
        members: Number(guild?.['memberCount'] ?? 0),
        cases,
        openTickets,
        openIncidents,
        verifiedMembers: verified,
        robloxServers: servers,
      };
    },
  };
}
