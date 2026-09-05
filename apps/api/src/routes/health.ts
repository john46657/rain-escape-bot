import type { FastifyInstance } from 'fastify';

/**
 * Health-Endpunkte fuer Container-Orchestrierung (Regel 49).
 *  - /health/live  : Prozess laeuft (kein Abhaengigkeitscheck)
 *  - /health/ready : Datenbank und Cache erreichbar
 */
export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  const startedAt = Date.now();

  app.get('/health/live', async () => ({ status: 'ok', uptimeMs: Date.now() - startedAt }));

  app.get('/health/ready', async (_request, reply) => {
    const [database, cache] = await Promise.all([
      app.nexus.store.healthy().catch(() => false),
      app.nexus.cache.healthy().catch(() => false),
    ]);
    const ready = database && cache;
    return reply.status(ready ? 200 : 503).send({
      status: ready ? 'ok' : 'degraded',
      checks: {
        database: { ok: database, driver: app.nexus.store.kind },
        cache: { ok: cache, driver: app.nexus.cache.kind },
      },
      version: '1.0.0',
      devMode: app.nexus.env.DEV_MODE,
    });
  });
}
