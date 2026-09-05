import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generateApiKey, hashApiKey } from '@nexus/security';
import { NotFoundError, ValidationError } from '@nexus/shared';
import { assertGuildAccess, requireAuth } from '../plugins/auth.js';

/**
 * Entwicklerportal (Regel 47).
 *
 * Der Schluessel wird genau einmal im Klartext zurueckgegeben. Danach
 * existiert nur noch der SHA-256-Hash sowie Praefix und letzte vier Zeichen
 * zur Wiedererkennung — ein Wiederanzeigen ist technisch unmoeglich.
 */
export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  const { store, cache } = app.nexus;

  const guildParams = z.object({ guildId: z.string().min(5).max(30) });

  app.get('/api/v1/guilds/:guildId/keys', async (request, reply) => {
    const auth = requireAuth(request);
    const { guildId } = guildParams.parse(request.params);
    assertGuildAccess(auth, guildId, reply);

    const keys = await store.apiKeys.list(guildId);
    return {
      data: keys.map((key) => ({
        id: key.id,
        name: key.name,
        prefix: key.prefix,
        last4: key.last4,
        scopes: key.scopes,
        environment: key.environment,
        usageCount: key.usageCount,
        lastUsedAt: key.lastUsedAt,
        revokedAt: key.revokedAt,
        createdAt: key.createdAt,
      })),
    };
  });

  app.post('/api/v1/guilds/:guildId/keys', async (request, reply) => {
    const auth = requireAuth(request);
    const { guildId } = guildParams.parse(request.params);
    assertGuildAccess(auth, guildId, reply);

    const schema = z.object({
      name: z.string().min(3).max(60),
      scopes: z.array(z.string().min(3).max(40)).min(1).max(20),
      environment: z.enum(['live', 'test']).default('live'),
      rateLimitPerMinute: z.number().int().min(10).max(600).default(60),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Ungueltige Eingabe', parsed.error.flatten().fieldErrors);

    const generated = generateApiKey(parsed.data.environment);
    const key = await store.apiKeys.create({
      guildId,
      ownerId: auth.userId,
      name: parsed.data.name,
      keyHash: generated.hash,
      prefix: generated.prefix,
      last4: generated.last4,
      scopes: parsed.data.scopes,
      rateLimitPerMinute: parsed.data.rateLimitPerMinute,
      environment: parsed.data.environment,
      expiresAt: null,
    });

    await store.audit.log({
      guildId,
      actorId: auth.userId,
      actorType: 'dashboard',
      action: 'apikey.create',
      targetId: key.id,
      targetType: 'api_key',
      result: 'SUCCESS',
      reason: null,
      metadata: { name: key.name, scopes: key.scopes },
    });

    return reply.status(201).send({
      data: {
        id: key.id,
        name: key.name,
        // Einziger Moment, in dem der Klartext existiert.
        key: generated.plaintext,
        warning: 'Dieser Schluessel wird nur einmal angezeigt. Bitte sicher speichern.',
      },
    });
  });

  app.delete('/api/v1/keys/:keyId', async (request) => {
    const auth = requireAuth(request);
    const { keyId } = z.object({ keyId: z.string().min(1) }).parse(request.params);

    const keys = auth.guildId ? await store.apiKeys.list(auth.guildId) : [];
    const key = keys.find((entry) => entry.id === keyId);
    if (!key && auth.kind === 'apiKey') throw new NotFoundError('API-Key');

    await store.apiKeys.revoke(keyId);
    await store.audit.log({
      guildId: key?.guildId ?? null,
      actorId: auth.userId,
      actorType: 'dashboard',
      action: 'apikey.revoke',
      targetId: keyId,
      targetType: 'api_key',
      result: 'SUCCESS',
      reason: null,
      metadata: {},
    });
    return { ok: true };
  });

  app.get('/api/v1/keys/:keyId/requests', async (request) => {
    requireAuth(request);
    const { keyId } = z.object({ keyId: z.string().min(1) }).parse(request.params);
    return { data: await store.apiKeys.listRequests(keyId, 50) };
  });

  /** Pruefwerkzeug: verifiziert einen Schluessel, ohne ihn zu speichern. */
  app.post('/api/v1/keys/verify', async (request) => {
    requireAuth(request);
    const parsed = z.object({ key: z.string().min(10) }).safeParse(request.body);
    if (!parsed.success) throw new ValidationError('key fehlt', parsed.error.flatten().fieldErrors);
    const found = await store.apiKeys.findByHash(hashApiKey(parsed.data.key));
    return { data: { valid: Boolean(found), scopes: found?.scopes ?? [] } };
  });

  app.get('/api/v1/notifications', async (request) => {
    const auth = requireAuth(request);
    const query = z
      .object({ guildId: z.string().optional(), unreadOnly: z.coerce.boolean().default(false) })
      .parse(request.query);
    const items = await store.notifications.list({
      guildId: query.guildId,
      userId: auth.kind === 'session' ? undefined : auth.userId,
      unreadOnly: query.unreadOnly,
      limit: 50,
    });
    return { data: items };
  });

  app.post('/api/v1/notifications/:id/read', async (request) => {
    requireAuth(request);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    await store.notifications.markRead(id);
    await cache.publish('notification.read', { id });
    return { ok: true };
  });
}
