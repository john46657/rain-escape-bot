export const BRAND = {
  name: 'NEXUS',
  tagline: 'The Ultimate Discord × Roblox Network Platform',
  colors: {
    primary: 0x6d5efc,
    success: 0x22c55e,
    warning: 0xf59e0b,
    danger: 0xef4444,
    info: 0x38bdf8,
    neutral: 0x2b2d42,
    security: 0xff2d55,
  },
} as const;

export const LIMITS = {
  embedDescription: 4096,
  embedFieldValue: 1024,
  embedFields: 25,
  messageContent: 2000,
  autocompleteChoices: 25,
  bulkDeleteMax: 100,
  bulkDeleteMaxAgeDays: 14,
  maxTimeoutMs: 28 * 24 * 60 * 60 * 1000, // Discord-Limit: 28 Tage
} as const;

export const HEADERS = {
  apiKey: 'x-nexus-key',
  signature: 'x-nexus-signature',
  timestamp: 'x-nexus-timestamp',
  nonce: 'x-nexus-nonce',
  gameId: 'x-nexus-game',
  requestId: 'x-request-id',
} as const;

/** Nur diese Roblox-Domains werden fuer Avatare/Links vertraut. */
export const ROBLOX_TRUSTED_HOSTS = [
  'users.roblox.com',
  'thumbnails.roblox.com',
  'groups.roblox.com',
  'games.roblox.com',
  'apis.roblox.com',
  'www.roblox.com',
] as const;
