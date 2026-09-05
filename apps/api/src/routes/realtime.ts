import type { FastifyInstance } from 'fastify';
import { verifySession } from '@nexus/security';

/**
 * WebSocket fuer Live-Updates im Dashboard (Regel 39).
 *
 * Der Server pusht Ereignisse aus dem Redis-Bus (Bot -> API -> Browser).
 * Authentifiziert wird ueber das Session-Cookie; ohne gueltige Session
 * wird die Verbindung sofort geschlossen.
 */
const TOPICS = [
  'moderation.case', 'security.incident', 'security.automod', 'security.lockdown',
  'ticket.created', 'ticket.closed', 'roblox.event', 'roblox.heartbeat',
  'roblox.verified', 'levels.levelup', 'guild.joined', 'config.updated',
] as const;

export async function registerRealtimeRoutes(app: FastifyInstance): Promise<void> {
  const { cache, env, log } = app.nexus;

  app.get('/api/v1/realtime', { websocket: true }, (socket, request) => {
    const cookie = request.cookies['nexus_session'];
    const session = cookie ? verifySession(env.SESSION_SECRET, cookie) : null;
    if (!session && !env.DEV_MODE) {
      socket.close(4401, 'unauthorized');
      return;
    }

    const guildId = new URL(request.url, 'http://localhost').searchParams.get('guildId');
    const unsubscribers: Array<() => Promise<void>> = [];

    const send = (topic: string, payload: unknown): void => {
      if (socket.readyState !== socket.OPEN) return;
      socket.send(JSON.stringify({ topic, payload, at: Date.now() }));
    };

    void (async () => {
      for (const topic of TOPICS) {
        const unsubscribe = await cache.subscribe<{ guildId?: string }>(topic, (payload) => {
          // Nur Ereignisse des abonnierten Servers ausliefern.
          if (guildId && payload?.guildId && payload.guildId !== guildId) return;
          send(topic, payload);
        });
        unsubscribers.push(unsubscribe);
      }
      send('connected', { guildId, topics: TOPICS });
    })();

    // Heartbeat, damit Proxies die Verbindung nicht trennen.
    const ping = setInterval(() => {
      if (socket.readyState === socket.OPEN) socket.ping();
    }, 30_000);

    socket.on('close', () => {
      clearInterval(ping);
      void Promise.all(unsubscribers.map((unsubscribe) => unsubscribe().catch(() => undefined)));
      log.debug('WebSocket geschlossen', { guildId: guildId ?? undefined });
    });
  });
}
