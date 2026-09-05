import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PERMISSION_NODES } from '@nexus/permissions';
import { NotFoundError, ValidationError } from '@nexus/shared';
import { assertGuildAccess, requireAuth, requireScope } from '../plugins/auth.js';

/**
 * Lesende und schreibende Endpunkte fuer das Dashboard (Regel 36).
 * Alle Pfade unter `/api/v1/*`, versioniert und einheitlich paginiert.
 */
export async function registerGuildRoutes(app: FastifyInstance): Promise<void> {
  const { store, cache } = app.nexus;

  const guildParams = z.object({ guildId: z.string().min(5).max(30) });
  const pageQuery = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  });

  app.get('/api/v1/guilds', async (request) => {
    requireScope(request, 'guilds:read');
    const result = await store.guilds.list({ active: true, pageSize: 100 });
    return {
      data: result.items.map((guild) => ({
        id: guild.discordId,
        name: guild.name,
        icon: guild.icon,
        memberCount: guild.memberCount,
        premiumTier: guild.premiumTier,
      })),
      meta: { total: result.total },
    };
  });

  app.get('/api/v1/guilds/:guildId', async (request, reply) => {
    const auth = requireScope(request, 'guilds:read');
    const { guildId } = guildParams.parse(request.params);
    assertGuildAccess(auth, guildId, reply);

    const guild = await store.guilds.findByDiscordId(guildId);
    if (!guild) throw new NotFoundError('Server');
    const [config, summary] = await Promise.all([
      store.guilds.getConfig(guildId),
      store.analytics.summary(guildId),
    ]);
    return { data: { guild, config, summary } };
  });

  app.patch('/api/v1/guilds/:guildId/config', async (request, reply) => {
    const auth = requireScope(request, 'guilds:write');
    const { guildId } = guildParams.parse(request.params);
    assertGuildAccess(auth, guildId, reply);

    // Nur ausgewaehlte Felder sind ueber die API aenderbar.
    const schema = z.object({
      locale: z.enum(['de', 'en']).optional(),
      modLogChannelId: z.string().nullable().optional(),
      securityChannelId: z.string().nullable().optional(),
      automodEnabled: z.boolean().optional(),
      antiNukeEnabled: z.boolean().optional(),
      ticketsEnabled: z.boolean().optional(),
      levelsEnabled: z.boolean().optional(),
      economyEnabled: z.boolean().optional(),
      robloxEnabled: z.boolean().optional(),
      minAccountAgeDays: z.number().int().min(0).max(365).optional(),
      xpPerMessage: z.number().int().min(0).max(100).optional(),
      currencyName: z.string().min(1).max(30).optional(),
      currencySymbol: z.string().min(1).max(8).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Ungueltige Konfiguration', parsed.error.flatten().fieldErrors);

    const config = await store.guilds.updateConfig(guildId, parsed.data);
    await cache.delete(`config:${guildId}`);
    await store.audit.log({
      guildId,
      actorId: auth.userId,
      actorType: auth.kind === 'apiKey' ? 'api' : 'dashboard',
      action: 'config.update',
      targetId: guildId,
      targetType: 'guild',
      result: 'SUCCESS',
      reason: null,
      metadata: { fields: Object.keys(parsed.data) },
    });
    await cache.publish('config.updated', { guildId });
    return { data: config };
  });

  app.get('/api/v1/guilds/:guildId/cases', async (request, reply) => {
    const auth = requireScope(request, 'moderation:read');
    const { guildId } = guildParams.parse(request.params);
    assertGuildAccess(auth, guildId, reply);
    const query = pageQuery.extend({ targetId: z.string().optional() }).parse(request.query);
    const result = await store.moderation.listCases(guildId, query);
    return { data: result.items, meta: { total: result.total, page: result.page, pageSize: result.pageSize } };
  });

  app.get('/api/v1/guilds/:guildId/incidents', async (request, reply) => {
    const auth = requireScope(request, 'security:read');
    const { guildId } = guildParams.parse(request.params);
    assertGuildAccess(auth, guildId, reply);
    const query = pageQuery.parse(request.query);
    const result = await store.security.listIncidents({ guildId, ...query });
    return { data: result.items, meta: { total: result.total, page: result.page } };
  });

  app.get('/api/v1/guilds/:guildId/tickets', async (request, reply) => {
    const auth = requireScope(request, 'tickets:read');
    const { guildId } = guildParams.parse(request.params);
    assertGuildAccess(auth, guildId, reply);
    const result = await store.tickets.list(guildId, pageQuery.parse(request.query));
    return { data: result.items, meta: { total: result.total } };
  });

  app.get('/api/v1/guilds/:guildId/audit', async (request, reply) => {
    const auth = requireScope(request, 'audit:read');
    const { guildId } = guildParams.parse(request.params);
    assertGuildAccess(auth, guildId, reply);
    const result = await store.audit.list({ guildId, ...pageQuery.parse(request.query) });
    return { data: result.items, meta: { total: result.total } };
  });

  app.get('/api/v1/guilds/:guildId/leaderboard', async (request, reply) => {
    const auth = requireScope(request, 'levels:read');
    const { guildId } = guildParams.parse(request.params);
    assertGuildAccess(auth, guildId, reply);
    const [levels, economy] = await Promise.all([
      store.levels.leaderboard(guildId, 10),
      store.economy.leaderboard(guildId, 10),
    ]);
    return { data: { levels, economy } };
  });

  app.get('/api/v1/guilds/:guildId/roblox', async (request, reply) => {
    const auth = requireScope(request, 'roblox:read');
    const { guildId } = guildParams.parse(request.params);
    assertGuildAccess(auth, guildId, reply);

    const games = await store.roblox.listGames(guildId);
    const servers = await Promise.all(games.map((game) => store.roblox.listServers(game.id)));
    return {
      data: games.map((game, index) => ({
        id: game.id,
        name: game.name,
        universeId: game.universeId,
        active: game.active,
        lastEventAt: game.lastEventAt,
        // Das Secret wird nie ausgeliefert — nur ein Hinweis auf den Anfang.
        secretHint: game.secretHint,
        servers: (servers[index] ?? []).map((server) => ({
          jobId: server.jobId,
          playerCount: server.playerCount,
          maxPlayers: server.maxPlayers,
          fps: server.fps,
          status: server.status,
          lastHeartbeatAt: server.lastHeartbeatAt,
        })),
      })),
    };
  });

  app.get('/api/v1/guilds/:guildId/analytics', async (request, reply) => {
    const auth = requireScope(request, 'analytics:read');
    const { guildId } = guildParams.parse(request.params);
    assertGuildAccess(auth, guildId, reply);
    const summary = await store.analytics.summary(guildId);
    const now = new Date();
    const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const series = await store.analytics.query(guildId, 'discord', from, now, 'day');
    return { data: { summary, series } };
  });

  app.get('/api/v1/permissions/nodes', async (request) => {
    requireAuth(request);
    return { data: PERMISSION_NODES };
  });
}
