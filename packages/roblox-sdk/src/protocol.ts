/**
 * Vertrag zwischen Roblox-Game-Server und NEXUS-API.
 *
 * Beide Seiten (Luau-SDK und API) implementieren exakt dieses Protokoll.
 * Aenderungen erfordern eine Versionserhoehung.
 */
export const NEXUS_PROTOCOL_VERSION = '1.0';

export const ROBLOX_ENDPOINTS = {
  handshake: '/api/v1/roblox/handshake',
  heartbeat: '/api/v1/roblox/heartbeat',
  events: '/api/v1/roblox/events',
  verify: '/api/v1/roblox/verify',
  commands: '/api/v1/roblox/commands',
  acknowledge: '/api/v1/roblox/commands/ack',
} as const;

/** Standardisierte Fehlercodes fuer die Luau-Seite. */
export const ROBLOX_ERROR_CODES = {
  SIGNATURE_INVALID: 'signature_invalid',
  REPLAY_DETECTED: 'replay_detected',
  CLOCK_SKEW: 'clock_skew',
  UNKNOWN_GAME: 'unknown_game',
  RATE_LIMITED: 'rate_limited',
  VALIDATION: 'validation_error',
} as const;

export interface HandshakeResponse {
  ok: true;
  protocol: string;
  gameId: string;
  serverTime: number;
  /** Vom Server vorgegebene Intervalle — der Client haelt sich daran. */
  heartbeatIntervalSeconds: number;
  commandPollIntervalSeconds: number;
}
