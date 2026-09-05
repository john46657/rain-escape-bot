import type { AntiNukeThresholds, AutomodRuleConfig, GuildConfigEntity } from './entities.js';
import type { AutomodRule } from '@nexus/shared';

/** Sichere Standardwerte fuer AutoMod — bewusst konservativ (Regel 6). */
export const DEFAULT_AUTOMOD: Record<AutomodRule, AutomodRuleConfig> = {
  ANTI_SPAM: { enabled: true, action: 'TIMEOUT', threshold: 6, windowSeconds: 8, timeoutMs: 300_000, exemptRoleIds: [], exemptChannelIds: [] },
  ANTI_FLOOD: { enabled: true, action: 'DELETE', threshold: 4, windowSeconds: 3, exemptRoleIds: [], exemptChannelIds: [] },
  ANTI_CAPS: { enabled: true, action: 'DELETE', threshold: 75, windowSeconds: 0, exemptRoleIds: [], exemptChannelIds: [] },
  ANTI_INVITE: { enabled: true, action: 'DELETE', threshold: 1, windowSeconds: 0, exemptRoleIds: [], exemptChannelIds: [] },
  ANTI_LINK: { enabled: false, action: 'DELETE', threshold: 1, windowSeconds: 0, exemptRoleIds: [], exemptChannelIds: [], entries: ['discord.com', 'roblox.com'] },
  ANTI_MENTION_SPAM: { enabled: true, action: 'TIMEOUT', threshold: 6, windowSeconds: 10, timeoutMs: 600_000, exemptRoleIds: [], exemptChannelIds: [] },
  ANTI_SCAM: { enabled: true, action: 'TIMEOUT', threshold: 70, windowSeconds: 0, timeoutMs: 3_600_000, exemptRoleIds: [], exemptChannelIds: [] },
  ANTI_PHISHING: { enabled: true, action: 'TIMEOUT', threshold: 1, windowSeconds: 0, timeoutMs: 3_600_000, exemptRoleIds: [], exemptChannelIds: [] },
  BAD_WORDS: { enabled: false, action: 'DELETE', threshold: 1, windowSeconds: 0, exemptRoleIds: [], exemptChannelIds: [], entries: [] },
  RAID_DETECTION: { enabled: true, action: 'LOG_ONLY', threshold: 8, windowSeconds: 20, exemptRoleIds: [], exemptChannelIds: [] },
};

export const DEFAULT_ANTINUKE: AntiNukeThresholds = {
  banPerMinute: 4,
  kickPerMinute: 5,
  channelDeletePerMinute: 3,
  roleDeletePerMinute: 3,
  webhookCreatePerMinute: 3,
  memberUpdatePerMinute: 12,
  botAddPerHour: 2,
};

export function defaultGuildConfig(guildId: string): GuildConfigEntity {
  return {
    guildId,
    timezone: 'Europe/Berlin',
    modLogChannelId: null,
    auditLogChannelId: null,
    securityChannelId: null,
    robloxLogChannelId: null,
    moderationEnabled: true,
    automodEnabled: true,
    antiNukeEnabled: true,
    ticketsEnabled: true,
    levelsEnabled: true,
    economyEnabled: true,
    gamesEnabled: true,
    giveawaysEnabled: true,
    musicEnabled: false,
    aiEnabled: false,
    robloxEnabled: false,
    welcomeChannelId: null,
    welcomeMessage: null,
    goodbyeChannelId: null,
    goodbyeMessage: null,
    boostChannelId: null,
    suggestionChannelId: null,
    starboardChannelId: null,
    starboardThreshold: 5,
    birthdayChannelId: null,
    autoRoleIds: [],
    memberCounters: [],
    xpPerMessage: 15,
    xpCooldownSeconds: 60,
    xpMultiplier: 1,
    levelUpChannelId: null,
    levelUpMessage: null,
    xpIgnoredChannels: [],
    currencyName: 'Nexus Coins',
    currencySymbol: '⬢',
    dailyAmount: 250,
    weeklyAmount: 1500,
    workMinAmount: 50,
    workMaxAmount: 400,
    startingBalance: 100,
    antiNukeWhitelist: [],
    automodConfig: DEFAULT_AUTOMOD,
    antiNukeThresholds: DEFAULT_ANTINUKE,
    raidModeEnabled: false,
    minAccountAgeDays: 0,
    lockdownActive: false,
    lockdownReason: null,
    lockdownAt: null,
    lockdownBy: null,
    lockdownSnapshot: [],
    verifiedRoleId: null,
    unverifiedRoleId: null,
    robloxNicknameSync: false,
    nicknameTemplate: '{robloxName}',
  };
}

export function emptyXpProfile(guildId: string, userId: string) {
  return {
    guildId, userId, xp: 0, level: 0, totalXp: 0, prestige: 0,
    messages: 0, voiceMinutes: 0, lastXpAt: null as Date | null,
  };
}
