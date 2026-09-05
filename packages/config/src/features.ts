/**
 * Feature-Flags und Premium-Tiers (Regel 46).
 *
 * Jede Funktion, die nicht in allen Tiers verfuegbar ist, muss hier
 * deklariert werden. `assertFeature` wird vor der Ausfuehrung geprueft.
 */
import { FeatureLockedError, type PremiumTier } from '@nexus/shared';

export const FEATURES = {
  'analytics.basic': 'FREE',
  'analytics.advanced': 'PREMIUM',
  'analytics.network': 'PREMIUM_PLUS',
  'ai.assistant': 'PREMIUM',
  'ai.moderation-suggestions': 'PREMIUM',
  'automation.basic': 'FREE',
  'automation.advanced': 'PREMIUM',
  'backup.extended': 'PREMIUM',
  'security.advanced': 'PREMIUM_PLUS',
  'roblox.multi-game': 'PREMIUM_PLUS',
  'api.extended': 'PREMIUM_PLUS',
  'tickets.transcripts': 'FREE',
  'economy.trading': 'FREE',
} as const satisfies Record<string, PremiumTier>;

export type FeatureKey = keyof typeof FEATURES;

const TIER_RANK: Record<PremiumTier, number> = { FREE: 0, PREMIUM: 1, PREMIUM_PLUS: 2 };

/** Grenzwerte pro Tier — verhindert Ressourcenmissbrauch. */
export const TIER_LIMITS: Record<PremiumTier, {
  backups: number;
  automations: number;
  robloxGames: number;
  apiKeys: number;
  apiRequestsPerMinute: number;
  ticketPanels: number;
}> = {
  FREE: { backups: 2, automations: 5, robloxGames: 1, apiKeys: 2, apiRequestsPerMinute: 60, ticketPanels: 1 },
  PREMIUM: { backups: 15, automations: 40, robloxGames: 3, apiKeys: 10, apiRequestsPerMinute: 300, ticketPanels: 5 },
  PREMIUM_PLUS: { backups: 50, automations: 200, robloxGames: 25, apiKeys: 50, apiRequestsPerMinute: 1200, ticketPanels: 25 },
};

export function hasFeature(tier: PremiumTier, feature: FeatureKey): boolean {
  return TIER_RANK[tier] >= TIER_RANK[FEATURES[feature]];
}

export function assertFeature(tier: PremiumTier, feature: FeatureKey): void {
  if (!hasFeature(tier, feature)) throw new FeatureLockedError(feature, FEATURES[feature]);
}

export function limitFor<K extends keyof (typeof TIER_LIMITS)['FREE']>(tier: PremiumTier, key: K): number {
  return TIER_LIMITS[tier][key];
}
