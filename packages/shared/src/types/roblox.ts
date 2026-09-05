import { z } from 'zod';

/**
 * Roblox -> NEXUS Event-Vertrag.
 *
 * Alle Events kommen ausschliesslich von einem Roblox *Server*-Script
 * (Regel 52: keine clientseitige Sicherheitslogik). Die Signatur wird in
 * `packages/security` geprueft.
 */
export const ROBLOX_EVENT_TYPES = [
  'PLAYER_JOIN',
  'PLAYER_LEAVE',
  'PLAYER_BAN',
  'PLAYER_KICK',
  'SERVER_START',
  'SERVER_SHUTDOWN',
  'SERVER_HEARTBEAT',
  'ACHIEVEMENT',
  'LEVEL_UP',
  'PURCHASE',
  'GAME_EVENT',
  'SECURITY_EVENT',
] as const;
export type RobloxEventType = (typeof ROBLOX_EVENT_TYPES)[number];

export const robloxPlayerRefSchema = z.object({
  userId: z.coerce.string().regex(/^\d{1,20}$/, 'Roblox UserID muss numerisch sein'),
  username: z.string().min(1).max(64).optional(),
  displayName: z.string().min(1).max(64).optional(),
});
export type RobloxPlayerRef = z.infer<typeof robloxPlayerRefSchema>;

export const robloxEventSchema = z.object({
  /** Idempotenzschluessel: verhindert doppelte Verarbeitung bei Retries. */
  eventId: z.string().min(8).max(128),
  type: z.enum(ROBLOX_EVENT_TYPES),
  gameId: z.coerce.string().regex(/^\d{1,20}$/),
  placeId: z.coerce
    .string()
    .regex(/^\d{1,20}$/)
    .optional(),
  jobId: z.string().max(128).optional(),
  occurredAt: z.coerce.date(),
  player: robloxPlayerRefSchema.optional(),
  /** Frei definierbare Nutzlast pro Event-Typ, serverseitig validiert. */
  payload: z.record(z.unknown()).default({}),
});
export type RobloxEvent = z.infer<typeof robloxEventSchema>;

export const robloxHeartbeatSchema = z.object({
  gameId: z.coerce.string(),
  placeId: z.coerce.string(),
  jobId: z.string().min(1),
  region: z.string().max(32).optional(),
  playerCount: z.number().int().min(0).max(1000),
  maxPlayers: z.number().int().min(1).max(1000),
  version: z.string().max(64).optional(),
  uptimeSeconds: z.number().int().min(0),
  fps: z.number().min(0).max(1000).optional(),
  memoryMb: z.number().min(0).optional(),
  players: z.array(robloxPlayerRefSchema).max(200).default([]),
});
export type RobloxHeartbeat = z.infer<typeof robloxHeartbeatSchema>;

/** NEXUS -> Roblox Kommandos (werden vom Game-Server abgeholt). */
export const ROBLOX_COMMAND_TYPES = [
  'ANNOUNCE',
  'KICK_PLAYER',
  'BAN_PLAYER',
  'UNBAN_PLAYER',
  'GRANT_REWARD',
  'SET_STAT',
  'SHUTDOWN_SERVER',
  'CUSTOM_EVENT',
] as const;
export type RobloxCommandType = (typeof ROBLOX_COMMAND_TYPES)[number];

export const ROBLOX_COMMAND_STATUSES = ['PENDING', 'DELIVERED', 'ACKNOWLEDGED', 'FAILED', 'EXPIRED'] as const;
export type RobloxCommandStatus = (typeof ROBLOX_COMMAND_STATUSES)[number];

/** Kommandos, die zwingend Bestaetigung + erhoehte Rechte brauchen (Regel 22). */
export const DANGEROUS_ROBLOX_COMMANDS: readonly RobloxCommandType[] = [
  'BAN_PLAYER',
  'SHUTDOWN_SERVER',
  'SET_STAT',
];

export const robloxCommandSchema = z.object({
  id: z.string(),
  type: z.enum(ROBLOX_COMMAND_TYPES),
  gameId: z.string(),
  jobId: z.string().nullable().optional(),
  payload: z.record(z.unknown()).default({}),
  issuedAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
});
export type RobloxCommand = z.infer<typeof robloxCommandSchema>;

export const robloxSecuritySignalSchema = z.object({
  kind: z.enum([
    'CURRENCY_ANOMALY',
    'STAT_ANOMALY',
    'ITEM_ANOMALY',
    'TRADE_ANOMALY',
    'ADMIN_ANOMALY',
    'TELEPORT_ANOMALY',
    'RATE_ANOMALY',
  ]),
  metric: z.string().max(64),
  observed: z.number(),
  expectedMax: z.number(),
  windowSeconds: z.number().int().positive(),
});
export type RobloxSecuritySignal = z.infer<typeof robloxSecuritySignalSchema>;
