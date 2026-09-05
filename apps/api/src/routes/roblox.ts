import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ReplayGuard, verifySignature } from '@nexus/security';
import { ROBLOX_ENDPOINTS, ROBLOX_ERROR_CODES, NEXUS_PROTOCOL_VERSION } from '@nexus/roblox-sdk';
import {
  ForbiddenError, MINUTE, PreconditionError, UnauthorizedError, ValidationError, uuid,
} from '@nexus/shared';
import { VerificationService } from '@nexus/module-roblox';

/**
 * Roblox-Schnittstelle (Regeln 23-27).
 *
 * Jede Anfrage eines Game-Servers wird geprueft auf:
 *   1. bekannter API-Key (`x-nexus-key`) und aktives Spiel
 *   2. HMAC-SHA256-Signatur ueber METHOD\nPATH\nTIMESTAMP\nNONCE\nBODY
 *   3. Zeitfenster (Uhrzeit-Abweichung) und Einmal-Nonce (Replay-Schutz)
 *   4. Rate Limit je Spiel
 *
 * Die Roblox-UserId stammt IMMER aus `Player.UserId` auf dem Game-Server;
 * es gibt keinen Pfad, auf dem ein Client eine fremde ID behaupten kann
 * (Regel 53).
 */

const heartbeatSchema = z.object({
  jobId: z.string().min(1).max(100),
  placeId: z.string().optional(),
  region: z.string().max(50).optional(),
  playerCount: z.number().int().min(0).max(1000),
  maxPlayers: z.number().int().min(0).max(1000),
  version: z.string().max(50).optional(),
  fps: z.number().min(0).max(1000).optional(),
  memoryMb: z.number().min(0).optional(),
  uptimeSeconds: z.number().min(0).optional(),
  players: z
    .array(z.object({ userId: z.string(), username: z.string(), joinedAt: z.number() }))
    .max(200)
    .default([]),
});

const eventSchema = z.object({
  events: z
    .array(
      z.object({
        eventId: z.string().min(8).max(80),
        type: z.string().min(1).max(60),
        jobId: z.string().max(100).optional(),
        robloxUserId: z.string().max(30).optional(),
        occurredAt: z.number().int(),
        payload: z.record(z.unknown()).default({}),
      }),
    )
    .min(1)
    .max(50),
});

const verifySchema = z.object({
  code: z.string().min(4).max(40),
  robloxUserId: z.string().min(1).max(30),
  username: z.string().min(1).max(50),
  displayName: z.string().max(50).optional(),
  jobId: z.string().max(100).optional(),
});

const ackSchema = z.object({
  commandId: z.string().min(1),
  ok: z.boolean(),
  message: z.string().max(500).optional(),
});

export async function registerRobloxRoutes(app: FastifyInstance): Promise<void> {
  const { store, cache, env, log } = app.nexus;
  const replayGuard = new ReplayGuard(cache, env.ROBLOX_REQUEST_SKEW_SECONDS);

  /**
   * Authentifiziert einen Game-Server.
   * Gibt das Spiel zurueck oder wirft einen sprechenden Fehler.
   */
  async function authenticate(request: FastifyRequest): Promise<{ gameId: string; universeId: string; guildId: string }> {
    const apiKeyHeader = request.headers['x-nexus-key'];
    const signature = request.headers['x-nexus-signature'];
    const timestamp = request.headers['x-nexus-timestamp'];
    const nonce = request.headers['x-nexus-nonce'];
    const universeId = request.headers['x-nexus-game'];

    if (!apiKeyHeader || !signature || !timestamp || !nonce || !universeId) {
      throw new UnauthorizedError('Signatur-Header unvollstaendig', { code: ROBLOX_ERROR_CODES.SIGNATURE_INVALID });
    }

    const game = await store.roblox.getGameByUniverse(String(universeId));
    if (!game || !game.active) {
      throw new ForbiddenError('Unbekanntes oder deaktiviertes Universum', { code: ROBLOX_ERROR_CODES.UNKNOWN_GAME });
    }

    // Rate Limit je Spiel — ein kompromittierter Server darf nicht alles lahmlegen.
    const limit = await cache.rateLimit('roblox-game', game.id, env.ROBLOX_RATE_LIMIT_PER_MINUTE, 60_000);
    if (!limit.allowed) {
      throw new ForbiddenError('Rate Limit erreicht', {
        code: ROBLOX_ERROR_CODES.RATE_LIMITED, retryAfterMs: limit.resetAfterMs,
      });
    }

    const rawBody = (request as { rawBody?: string }).rawBody ?? '';
    const result = verifySignature(
      env.ROBLOX_SIGNING_SECRET,
      {
        method: request.method,
        path: request.url.split('?')[0] ?? request.url,
        timestamp: String(timestamp),
        nonce: String(nonce),
        body: rawBody,
      },
      String(signature),
      env.ROBLOX_REQUEST_SKEW_SECONDS,
    );

    if (!result.valid) {
      log.security('Roblox-Anfrage abgelehnt', {
        universeId: String(universeId), reason: result.reason, ip: request.ip,
      });
      const codes: Record<string, string> = {
        MISMATCH: ROBLOX_ERROR_CODES.SIGNATURE_INVALID,
        MALFORMED: ROBLOX_ERROR_CODES.SIGNATURE_INVALID,
        SKEW: ROBLOX_ERROR_CODES.CLOCK_SKEW,
      };
      throw new UnauthorizedError('Signaturpruefung fehlgeschlagen', {
        code: codes[result.reason ?? 'MISMATCH'] ?? ROBLOX_ERROR_CODES.SIGNATURE_INVALID,
      });
    }

    // Replay-Schutz: die Nonce darf im Zeitfenster nur einmal auftauchen.
    const fresh = await replayGuard.register(game.id, String(nonce));
    if (!fresh) {
      log.security('Replay erkannt', { universeId: String(universeId), ip: request.ip });
      throw new UnauthorizedError('Nonce bereits verwendet', { code: ROBLOX_ERROR_CODES.REPLAY_DETECTED });
    }

    return { gameId: game.id, universeId: game.universeId, guildId: game.guildId };
  }

  // ------------------------------------------------------------ Handshake
  app.post(ROBLOX_ENDPOINTS.handshake, async (request) => {
    const game = await authenticate(request);
    return {
      ok: true,
      protocol: NEXUS_PROTOCOL_VERSION,
      gameId: game.gameId,
      serverTime: Math.floor(Date.now() / 1000),
      heartbeatIntervalSeconds: 30,
      commandPollIntervalSeconds: 5,
    };
  });

  // ------------------------------------------------------------ Heartbeat
  app.post(ROBLOX_ENDPOINTS.heartbeat, async (request) => {
    const game = await authenticate(request);
    const parsed = heartbeatSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Ungueltige Heartbeat-Daten', parsed.error.flatten().fieldErrors);

    const data = parsed.data;
    const server = await store.roblox.recordHeartbeat({
      gameId: game.gameId,
      jobId: data.jobId,
      placeId: data.placeId ?? null,
      region: data.region ?? null,
      playerCount: data.playerCount,
      maxPlayers: data.maxPlayers,
      version: data.version ?? null,
      fps: data.fps ?? null,
      memoryMb: data.memoryMb ?? null,
      lastHeartbeatAt: new Date(),
      startedAt: data.uptimeSeconds ? new Date(Date.now() - data.uptimeSeconds * 1000) : undefined,
      players: data.players.map((player) => ({
        userId: player.userId, username: player.username, joinedAt: player.joinedAt,
      })),
    });

    await app.nexus.cache.publish('roblox.heartbeat', {
      guildId: game.guildId, gameId: game.gameId, jobId: data.jobId, playerCount: data.playerCount,
    });

    return { ok: true, serverId: server.id, serverTime: Math.floor(Date.now() / 1000) };
  });

  // --------------------------------------------------------------- Events
  app.post(ROBLOX_ENDPOINTS.events, async (request) => {
    const game = await authenticate(request);
    const parsed = eventSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Ungueltige Event-Daten', parsed.error.flatten().fieldErrors);

    const accepted: string[] = [];
    const duplicates: string[] = [];

    for (const incoming of parsed.data.events) {
      // Idempotenz ueber eventId — Wiederholungen sind ausdruecklich erlaubt.
      const { event, duplicate } = await store.roblox.recordEvent({
        gameId: game.gameId,
        eventId: incoming.eventId,
        type: incoming.type,
        jobId: incoming.jobId ?? null,
        robloxUserId: incoming.robloxUserId ?? null,
        payload: incoming.payload,
        occurredAt: new Date(incoming.occurredAt * 1000),
      });

      if (duplicate) {
        duplicates.push(incoming.eventId);
        continue;
      }
      accepted.push(incoming.eventId);

      // Sitzungen mitschreiben (Spielzeit-Statistik).
      if (incoming.type === 'PLAYER_JOIN' && incoming.robloxUserId) {
        const account = await store.roblox.getAccountByRobloxId(incoming.robloxUserId);
        await store.roblox.startSession({
          gameId: game.gameId,
          robloxUserId: incoming.robloxUserId,
          jobId: incoming.jobId ?? null,
          accountId: account?.id ?? null,
        });
      }
      if (incoming.type === 'PLAYER_LEAVE' && incoming.robloxUserId) {
        await store.roblox.endSession(game.gameId, incoming.robloxUserId, new Date());
      }

      await store.roblox.markEventProcessed(event.id);
      await cache.publish('roblox.event', {
        guildId: game.guildId, gameId: game.gameId, type: incoming.type,
        robloxUserId: incoming.robloxUserId ?? null, payload: incoming.payload,
      });
    }

    return { ok: true, accepted: accepted.length, duplicates: duplicates.length };
  });

  // --------------------------------------------------------- Verifizierung
  app.post(ROBLOX_ENDPOINTS.verify, async (request) => {
    const game = await authenticate(request);
    const parsed = verifySchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Ungueltige Verifizierungsdaten', parsed.error.flatten().fieldErrors);

    // Zusaetzliches, strengeres Limit: Codes duerfen nicht durchprobiert werden.
    const attempt = await cache.rateLimit('roblox-verify', `${game.gameId}:${parsed.data.robloxUserId}`, 5, 5 * MINUTE);
    if (!attempt.allowed) {
      throw new ForbiddenError('Zu viele Verifizierungsversuche', {
        code: ROBLOX_ERROR_CODES.RATE_LIMITED, retryAfterMs: attempt.resetAfterMs,
      });
    }

    // Der Verifizierungsdienst wird mit einer schmalen Abhaengigkeitsmenge
    // betrieben: die API hat keinen Discord-Client. Rollen setzt der Bot,
    // sobald er das Event `roblox.verified` empfaengt.
    const service = new VerificationService({
      store,
      roblox: app.nexus.roblox,
      log,
      publish: async (topic: string, payload: unknown) => {
        await cache.publish(topic, payload);
      },
    });

    try {
      const result = await service.redeem(
        parsed.data.code, parsed.data.robloxUserId, parsed.data.username, parsed.data.displayName,
      );
      return {
        ok: true,
        discordId: result.discordId,
        username: result.account.username,
        message: 'Verifizierung erfolgreich — deine Discord-Rollen werden gesetzt.',
      };
    } catch (error) {
      if (error instanceof PreconditionError) {
        return { ok: false, error: 'invalid_code', message: error.message };
      }
      throw error;
    }
  });

  // ----------------------------------------------------------- Kommandos
  app.post(ROBLOX_ENDPOINTS.commands, async (request) => {
    const game = await authenticate(request);
    const jobId = z.object({ jobId: z.string().max(100) }).safeParse(request.body);
    if (!jobId.success) throw new ValidationError('jobId fehlt', jobId.error.flatten().fieldErrors);

    const commands = await store.roblox.claimCommands(game.gameId, jobId.data.jobId, 10);
    return {
      ok: true,
      commands: commands.map((command) => ({
        id: command.id,
        type: command.type,
        payload: command.payload,
        issuedAt: Math.floor(command.createdAt.getTime() / 1000),
        expiresAt: Math.floor(command.expiresAt.getTime() / 1000),
      })),
    };
  });

  app.post(ROBLOX_ENDPOINTS.acknowledge, async (request) => {
    await authenticate(request);
    const parsed = ackSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Ungueltige Bestaetigung', parsed.error.flatten().fieldErrors);

    await store.roblox.acknowledgeCommand(parsed.data.commandId, {
      ok: parsed.data.ok,
      message: parsed.data.message,
    });
    return { ok: true };
  });

  // --------------------------------- Cross-Platform-Belohnungen (Regel 28)
  app.post('/api/v1/roblox/rewards/claim', async (request) => {
    const game = await authenticate(request);
    const schema = z.object({
      robloxUserId: z.string().min(1).max(30),
      rewardKey: z.string().min(1).max(60),
      idempotencyKey: z.string().min(8).max(120).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Ungueltige Anfrage', parsed.error.flatten().fieldErrors);

    const account = await store.roblox.getAccountByRobloxId(parsed.data.robloxUserId);
    if (!account) return { ok: false, error: 'not_linked', message: 'Kein verknuepftes Discord-Konto' };

    // Der Idempotenzschluessel verhindert doppelte Gutschriften bei Retries.
    const idempotencyKey = parsed.data.idempotencyKey ?? `reward:${game.gameId}:${parsed.data.robloxUserId}:${parsed.data.rewardKey}`;
    const { grant, created } = await store.rewards.grant({
      userId: account.discordId,
      guildId: game.guildId,
      idempotencyKey,
      kind: 'discord_coins',
      amount: 100,
      reference: parsed.data.rewardKey,
      source: `roblox:${game.universeId}`,
      status: 'PENDING',
    });

    if (created) {
      await store.economy.mutate({
        guildId: game.guildId,
        userId: account.discordId,
        target: 'wallet',
        amount: grant.amount,
        type: 'REWARD',
        reason: `Roblox-Belohnung ${parsed.data.rewardKey}`,
        idempotencyKey: `economy:${idempotencyKey}`,
      });
      await store.rewards.markGranted(grant.id);
    }

    return { ok: true, granted: created, amount: grant.amount, grantId: grant.id, requestId: uuid() };
  });
}
