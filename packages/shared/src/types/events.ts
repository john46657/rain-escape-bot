/** Realtime-Kanaele fuer das Dashboard (WebSocket). */
export const REALTIME_CHANNELS = [
  'security', 'moderation', 'tickets', 'roblox', 'system', 'economy', 'analytics',
] as const;
export type RealtimeChannel = (typeof REALTIME_CHANNELS)[number];

export interface RealtimeEvent<T = unknown> {
  id: string;
  channel: RealtimeChannel;
  type: string;
  guildId?: string;
  at: string;
  data: T;
}

/** Payload des internen Event-Bus (Bot <-> API ueber Redis Pub/Sub). */
export interface BusMessage<T = unknown> {
  topic: string;
  payload: T;
  publishedAt: number;
  origin: 'bot' | 'api' | 'dashboard' | 'roblox';
}
