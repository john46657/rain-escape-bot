import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiKeyEntity } from '@nexus/database';
import { hashApiKey, verifySession } from '@nexus/security';
import { ForbiddenError, UnauthorizedError } from '@nexus/shared';

/**
 * Authentifizierung (Regel 37).
 *
 * Zwei Verfahren:
 *  1. API-Key (`Authorization: Bearer nxs_...`) fuer Maschinen-Zugriffe.
 *     Gespeichert wird nur der SHA-256-Hash.
 *  2. Dashboard-Session-Cookie (signiertes Token) fuer Nutzer.
 *
 * Beide setzen `request.auth`; Routen entscheiden ueber die noetigen Scopes.
 */
export interface AuthContext {
  kind: 'apiKey' | 'session';
  userId: string;
  guildId: string | null;
  scopes: string[];
  apiKey?: ApiKeyEntity;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

/** Feste Demo-Identitaet des DEV_MODE (entspricht dem Seed-Owner). */
const DEV_DEMO_USER_ID = '200000000000000001';

let warnedAboutDevAuth = false;

export async function registerAuth(app: FastifyInstance): Promise<void> {
  const { store, env } = app.nexus;

  app.decorateRequest('auth', undefined);

  app.addHook('preHandler', async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer nxs_')) {
      const token = header.slice('Bearer '.length).trim();
      const key = await store.apiKeys.findByHash(hashApiKey(token));
      if (!key) throw new UnauthorizedError('Ungueltiger API-Key');
      if (key.expiresAt && key.expiresAt.getTime() < Date.now())
        throw new UnauthorizedError('API-Key abgelaufen');

      request.auth = {
        kind: 'apiKey',
        userId: key.ownerId,
        guildId: key.guildId,
        scopes: key.scopes,
        apiKey: key,
      };
      return;
    }

    const cookie = request.cookies['nexus_session'];
    if (cookie) {
      const session = verifySession(env.SESSION_SECRET, cookie);
      if (session) {
        request.auth = { kind: 'session', userId: session.discordId, guildId: null, scopes: ['dashboard'] };
        return;
      }
    }

    /**
     * DEV_MODE-Demo-Session.
     *
     * Nur aktiv, wenn DEV_MODE explizit gesetzt ist. Sie ermoeglicht das
     * Ausprobieren des Dashboards ohne Discord-OAuth. In Produktion ist
     * DEV_MODE aus, damit greift ausschliesslich der Pfad oben.
     */
    if (env.DEV_MODE) {
      request.auth = { kind: 'session', userId: DEV_DEMO_USER_ID, guildId: null, scopes: ['*'] };
      if (!warnedAboutDevAuth) {
        warnedAboutDevAuth = true;
        app.nexus.log.warn('DEV_MODE: Anfragen ohne Anmeldung werden als Demo-Session behandelt');
      }
    }
  });

  // Nutzung protokollieren (Developer-Portal zeigt sie an).
  app.addHook('onResponse', async (request, reply) => {
    const key = request.auth?.apiKey;
    if (!key) return;
    await store.apiKeys
      .recordUsage(key.id, {
        method: request.method,
        path: request.url.split('?')[0] ?? request.url,
        statusCode: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      })
      .catch(() => undefined);
  });
}

/** Erzwingt eine Authentifizierung. */
export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw new UnauthorizedError('Authentifizierung erforderlich');
  return request.auth;
}

/** Erzwingt einen bestimmten Scope (API-Keys) — Sessions sind ausgenommen. */
export function requireScope(request: FastifyRequest, scope: string): AuthContext {
  const auth = requireAuth(request);
  if (auth.kind === 'apiKey' && !auth.scopes.includes(scope) && !auth.scopes.includes('*')) {
    throw new ForbiddenError(`Scope "${scope}" fehlt`, { scope });
  }
  return auth;
}

/** Stellt sicher, dass der Zugriff zur angefragten Guild passt. */
export function assertGuildAccess(auth: AuthContext, guildId: string, reply: FastifyReply): void {
  if (auth.kind === 'apiKey' && auth.guildId && auth.guildId !== guildId) {
    void reply;
    throw new ForbiddenError('Der API-Key gilt nicht fuer diesen Server', { guildId });
  }
}
