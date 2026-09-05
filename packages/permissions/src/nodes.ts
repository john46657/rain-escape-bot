/**
 * Granulare Berechtigungsknoten (Regel 35).
 *
 * Aufbau: <plattform>.<bereich>.<aktion>
 * Wildcards sind erlaubt: `discord.moderation.*`, `roblox.*`, `*`.
 */
export const PERMISSION_NODES = [
  // Discord — Moderation
  'discord.moderation.view',
  'discord.moderation.warn',
  'discord.moderation.note',
  'discord.moderation.timeout',
  'discord.moderation.kick',
  'discord.moderation.ban',
  'discord.moderation.unban',
  'discord.moderation.clear',
  'discord.moderation.channel',
  'discord.moderation.role',
  'discord.moderation.nick',

  // Discord — Security
  'discord.security.view',
  'discord.security.manage',
  'discord.security.lockdown',
  'discord.security.lockdown.release',
  'discord.security.whitelist',
  'discord.security.incidents',

  // Discord — Verwaltung
  'discord.tickets.view',
  'discord.tickets.manage',
  'discord.tickets.claim',
  'discord.tickets.close',
  'discord.giveaways.manage',
  'discord.levels.manage',
  'discord.economy.manage',
  'discord.community.manage',
  'discord.backup.view',
  'discord.backup.create',
  'discord.backup.restore',
  'discord.backup.delete',
  'discord.automation.manage',
  'discord.config.manage',

  // Roblox
  'roblox.view',
  'roblox.link.self',
  'roblox.link.manage',
  'roblox.moderation.kick',
  'roblox.moderation.ban',
  'roblox.moderation.unban',
  'roblox.server.announce',
  'roblox.server.shutdown',
  'roblox.rewards.grant',
  'roblox.groups.sync',
  'roblox.games.manage',

  // Dashboard / Plattform
  'dashboard.access',
  'dashboard.security.manage',
  'dashboard.settings.manage',
  'dashboard.developers.manage',
  'dashboard.analytics.view',
  'dashboard.ai.use',
] as const;

export type PermissionNode = (typeof PERMISSION_NODES)[number];

/** Aktionen, die zusaetzlich eine explizite Bestaetigung erfordern (Regel 22). */
export const CONFIRMATION_REQUIRED: readonly PermissionNode[] = [
  'discord.backup.restore',
  'discord.security.lockdown',
  'roblox.moderation.ban',
  'roblox.server.shutdown',
  'discord.moderation.ban',
];

export const PERMISSION_GROUPS: Record<string, readonly PermissionNode[]> = {
  Support: ['discord.moderation.view', 'discord.tickets.claim', 'discord.tickets.close', 'roblox.view'],
  Moderator: [
    'discord.moderation.view',
    'discord.moderation.warn',
    'discord.moderation.note',
    'discord.moderation.timeout',
    'discord.moderation.kick',
    'discord.moderation.clear',
    'discord.tickets.view',
    'discord.tickets.manage',
    'roblox.view',
    'roblox.moderation.kick',
  ],
  Administrator: [
    'discord.moderation.view',
    'discord.moderation.warn',
    'discord.moderation.note',
    'discord.moderation.timeout',
    'discord.moderation.kick',
    'discord.moderation.ban',
    'discord.moderation.unban',
    'discord.moderation.clear',
    'discord.moderation.channel',
    'discord.moderation.role',
    'discord.moderation.nick',
    'discord.security.view',
    'discord.security.manage',
    'discord.security.lockdown',
    'discord.tickets.manage',
    'discord.giveaways.manage',
    'discord.levels.manage',
    'discord.economy.manage',
    'discord.community.manage',
    'discord.backup.create',
    'discord.automation.manage',
    'dashboard.access',
    'dashboard.analytics.view',
    'roblox.view',
    'roblox.moderation.kick',
    'roblox.moderation.ban',
    'roblox.server.announce',
  ],
};
