/**
 * Zentrale Aufzaehlungen.
 *
 * Bewusst als String-Union + const-Array statt Prisma-Enum: das Schema muss
 * sowohl auf PostgreSQL (Produktion) als auch auf SQLite (lokaler Dev-Modus)
 * laufen, und SQLite kennt keine nativen Enums. Die Validierung passiert
 * dafuer konsequent in der Anwendungsschicht (zod).
 */
export const PREMIUM_TIERS = ['FREE', 'PREMIUM', 'PREMIUM_PLUS'] as const;
export type PremiumTier = (typeof PREMIUM_TIERS)[number];

export const MODERATION_ACTIONS = [
  'BAN', 'UNBAN', 'SOFTBAN', 'KICK', 'TIMEOUT', 'UNTIMEOUT', 'WARN', 'UNWARN',
  'CLEAR', 'SLOWMODE', 'LOCK', 'UNLOCK', 'NICK', 'ROLE_ADD', 'ROLE_REMOVE', 'NOTE',
] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export const AUTOMOD_RULES = [
  'ANTI_SPAM', 'ANTI_FLOOD', 'ANTI_CAPS', 'ANTI_INVITE', 'ANTI_LINK',
  'ANTI_MENTION_SPAM', 'ANTI_SCAM', 'ANTI_PHISHING', 'BAD_WORDS', 'RAID_DETECTION',
] as const;
export type AutomodRule = (typeof AUTOMOD_RULES)[number];

export const AUTOMOD_ACTIONS = ['DELETE', 'WARN', 'TIMEOUT', 'KICK', 'BAN', 'LOG_ONLY'] as const;
export type AutomodAction = (typeof AUTOMOD_ACTIONS)[number];

export const INCIDENT_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const INCIDENT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'MITIGATED', 'RESOLVED', 'FALSE_POSITIVE'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const TICKET_CATEGORIES = [
  'SUPPORT', 'REPORT', 'APPLICATION', 'PARTNERSHIP', 'COMPLAINT', 'UNBAN', 'OTHER',
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_STATUSES = ['OPEN', 'CLAIMED', 'LOCKED', 'CLOSED', 'DELETED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TRANSACTION_TYPES = [
  'DAILY', 'WEEKLY', 'WORK', 'CRIME', 'ROB', 'GAMBLE', 'SHOP_BUY', 'SHOP_SELL',
  'TRANSFER_IN', 'TRANSFER_OUT', 'DEPOSIT', 'WITHDRAW', 'REWARD', 'ADMIN_ADJUST', 'PROMO_CODE',
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const ACHIEVEMENT_RARITIES = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'SECRET'] as const;
export type AchievementRarity = (typeof ACHIEVEMENT_RARITIES)[number];

export const NOTIFICATION_CATEGORIES = [
  'SECURITY', 'MODERATION', 'TICKETS', 'ROBLOX', 'SYSTEM', 'ECONOMY',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const VERIFICATION_STATUSES = ['PENDING', 'VERIFIED', 'EXPIRED', 'REVOKED'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const LOCALES = ['de', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
