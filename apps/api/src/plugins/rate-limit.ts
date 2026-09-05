import type { FastifyInstance } from 'fastify';
import { RateLimitError } from '@nexus/shared';

/**
 * Globales Rate Limit pro IP (Regel 41).
 * API-Keys erhalten in `auth.ts` zusaetzlich ein eigenes, hoeheres Limit.
 */
export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  const { cache, env } = app.nexus;

  app.addHook('onRequest', async (request) => {
    if (request.url.startsWith('/health')) return;
    const identifier = request.headers['x-nexus-key']
      ? `key:${String(request.headers['x-nexus-key']).slice(0, 20)}`
      : `ip:${request.ip}`;

    const result = await cache.rateLimit('http', identifier, env.API_RATE_LIMIT_PER_MINUTE, 60_000);
    if (!result.allowed) {
      throw new RateLimitError(result.resetAfterMs, { scope: 'http' });
    }
  });
}
