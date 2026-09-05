/**
 * Fastify-Server (Regel 36-41).
 *
 * Als Factory aufgebaut, damit Tests eine Instanz ohne offenen Port bauen
 * koennen (`app.inject`).
 */
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { createCache, type CacheService } from '@nexus/cache';
import { loadEnv, type Env } from '@nexus/config';
import { createDataStore, type DataStore } from '@nexus/database';
import { createLogger, type Logger } from '@nexus/logger';
import { PermissionService } from '@nexus/permissions';
import { RobloxClient } from '@nexus/roblox-sdk';
import { NexusError, sortableId, toNexusError } from '@nexus/shared';
import { registerAuth } from './plugins/auth.js';
import { registerRateLimit } from './plugins/rate-limit.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerGuildRoutes } from './routes/guilds.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerRobloxRoutes } from './routes/roblox.js';
import { registerRealtimeRoutes } from './routes/realtime.js';

export interface ApiContext {
  env: Env;
  store: DataStore;
  cache: CacheService;
  permissions: PermissionService;
  roblox: RobloxClient;
  log: Logger;
}

declare module 'fastify' {
  interface FastifyInstance {
    nexus: ApiContext;
  }
}

export async function buildServer(overrides: Partial<ApiContext> = {}): Promise<FastifyInstance> {
  const env = overrides.env ?? loadEnv();
  const log = overrides.log ?? createLogger('api', { pretty: env.LOG_PRETTY, level: env.LOG_LEVEL });

  const context: ApiContext = {
    env,
    log,
    store: overrides.store ?? (await createDataStore()),
    cache: overrides.cache ?? (await createCache()),
    permissions: overrides.permissions ?? new PermissionService(),
    roblox: overrides.roblox ?? new RobloxClient({ apiKey: env.ROBLOX_API_KEY }),
  };

  const app = Fastify({
    // Der Roblox-Endpunkt signiert den Rohkoerper — er muss unveraendert vorliegen.
    bodyLimit: 1_000_000,
    trustProxy: true,
    genReqId: () => sortableId('req'),
    logger: false,
  });

  app.decorate('nexus', context);

  await app.register(cors, {
    origin: env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS.split(',').map((entry) => entry.trim()),
    credentials: true,
  });
  await app.register(cookie, { secret: env.SESSION_SECRET, hook: 'onRequest' });
  await app.register(websocket);

  // Rohkoerper fuer die Signaturpruefung bereitstellen.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    (request as { rawBody?: string }).rawBody = String(body);
    try {
      done(null, body === '' ? {} : (JSON.parse(String(body)) as unknown));
    } catch (error) {
      done(error instanceof Error ? error : new Error('Ungueltiges JSON'), undefined);
    }
  });

  await registerRateLimit(app);
  await registerAuth(app);

  // ---- Zugriffs-Logging (ohne Secrets) ----
  app.addHook('onResponse', async (request, reply) => {
    log.debug('HTTP', {
      requestId: String(request.id),
      method: request.method,
      path: request.url.split('?')[0],
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
    });
  });

  // ---- Einheitliche Fehlerantworten (Regel 40) ----
  app.setErrorHandler((error: unknown, request, reply) => {
    const nexusError = toNexusError(error);
    const status =
      error instanceof NexusError
        ? error.status
        : Number((error as { statusCode?: number }).statusCode ?? 500);

    if (status >= 500) {
      log.error('API-Fehler', nexusError, { requestId: String(request.id), path: request.url });
    }
    void reply.status(status || 500).send({
      error: {
        code: nexusError.code,
        message: status >= 500 ? 'Interner Serverfehler' : nexusError.message,
        requestId: String(request.id),
        ...(status < 500 && Object.keys(nexusError.meta).length > 0 ? { details: nexusError.meta } : {}),
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} existiert nicht` },
    });
  });

  // ---- Routen ----
  await registerHealthRoutes(app);
  await registerAuthRoutes(app);
  await registerGuildRoutes(app);
  await registerRobloxRoutes(app);
  await registerAdminRoutes(app);
  await registerRealtimeRoutes(app);

  return app;
}
