import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryDataStore } from '@nexus/database';
import { createLogger } from '@nexus/logger';
import { signRequest } from '@nexus/security';
import { loadEnv } from '@nexus/config';
import { CacheService } from '@nexus/cache';
import { buildServer } from '../apps/api/src/server.js';

/**
 * Integrationstest des Roblox-Endpunkts.
 * Prueft die komplette Kette: Signatur, Zeitfenster, Replay-Schutz,
 * Idempotenz und Kommando-Auslieferung.
 */
const SECRET = 'test-roblox-signing-secret-1234';
const UNIVERSE = '7654321';

let app: FastifyInstance;
let store: MemoryDataStore;

function sign(method: string, path: string, body: unknown, options: { timestamp?: number; nonce?: string } = {}) {
  const raw = JSON.stringify(body);
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const nonce = options.nonce ?? `nonce-${Math.random().toString(36).slice(2)}`;
  return {
    payload: raw,
    headers: {
      'content-type': 'application/json',
      'x-nexus-key': 'nxs_test_dummy',
      'x-nexus-game': UNIVERSE,
      'x-nexus-timestamp': timestamp,
      'x-nexus-nonce': nonce,
      'x-nexus-signature': signRequest(SECRET, { method, path, timestamp, nonce, body: raw }),
    },
  };
}

beforeAll(async () => {
  process.env['DEV_MODE'] = 'true';
  process.env['DEV_SEED'] = 'false';
  process.env['ROBLOX_SIGNING_SECRET'] = SECRET;

  store = new MemoryDataStore();
  await store.guilds.upsert({ discordId: 'g1', name: 'Test', ownerId: 'o1' });
  await store.roblox.upsertGame({
    guildId: 'g1', universeId: UNIVERSE, placeId: '1', name: 'Testspiel', iconUrl: null,
    signingSecretHash: 'hash', secretHint: 'nxs_', active: true, settings: {},
  });

  app = await buildServer({
    env: { ...loadEnv(), ROBLOX_SIGNING_SECRET: SECRET, DEV_MODE: true },
    store,
    cache: CacheService.memory('test'),
    log: createLogger('test', { level: 'error' }),
  });
});

afterAll(async () => {
  await app?.close();
});

describe('POST /api/v1/roblox/heartbeat', () => {
  const path = '/api/v1/roblox/heartbeat';
  const body = { jobId: 'job-1', playerCount: 12, maxPlayers: 30, players: [] };

  it('nimmt korrekt signierte Anfragen an', async () => {
    const { headers, payload } = sign('POST', path, body);
    const response = await app.inject({ method: 'POST', url: path, headers, payload });
    expect(response.statusCode).toBe(200);
    expect(response.json().ok).toBe(true);

    const games = await store.roblox.listGames('g1');
    const servers = await store.roblox.listServers(games[0]?.id);
    expect(servers[0]?.playerCount).toBe(12);
  });

  it('lehnt fehlende Signatur-Header ab', async () => {
    const response = await app.inject({ method: 'POST', url: path, payload: body });
    expect(response.statusCode).toBe(401);
  });

  it('lehnt eine falsche Signatur ab', async () => {
    const { headers, payload } = sign('POST', path, body);
    const response = await app.inject({
      method: 'POST', url: path, payload,
      headers: { ...headers, 'x-nexus-signature': 'f'.repeat(64) },
    });
    expect(response.statusCode).toBe(401);
  });

  it('lehnt manipulierte Nutzlast ab', async () => {
    const { headers } = sign('POST', path, body);
    const response = await app.inject({
      method: 'POST', url: path, headers,
      payload: JSON.stringify({ ...body, playerCount: 999 }),
    });
    expect(response.statusCode).toBe(401);
  });

  it('lehnt veraltete Zeitstempel ab', async () => {
    const { headers, payload } = sign('POST', path, body, {
      timestamp: Math.floor(Date.now() / 1000) - 4_000,
    });
    const response = await app.inject({ method: 'POST', url: path, headers, payload });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.details?.code).toBe('clock_skew');
  });

  it('erkennt einen Replay derselben Nonce', async () => {
    const signed = sign('POST', path, body, { nonce: 'wiederverwendet' });
    const first = await app.inject({ method: 'POST', url: path, headers: signed.headers, payload: signed.payload });
    const second = await app.inject({ method: 'POST', url: path, headers: signed.headers, payload: signed.payload });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(401);
    expect(second.json().error.details?.code).toBe('replay_detected');
  });

  it('lehnt unbekannte Universen ab', async () => {
    const { headers, payload } = sign('POST', path, body);
    const response = await app.inject({
      method: 'POST', url: path, payload,
      headers: { ...headers, 'x-nexus-game': '999999' },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('POST /api/v1/roblox/events', () => {
  const path = '/api/v1/roblox/events';

  it('nimmt Ereignisse an und erkennt Duplikate', async () => {
    const body = {
      events: [
        { eventId: 'evt-integration-1', type: 'PLAYER_JOIN', jobId: 'job-1', robloxUserId: '1', occurredAt: Math.floor(Date.now() / 1000), payload: {} },
      ],
    };
    const first = sign('POST', path, body);
    const second = sign('POST', path, body);

    const response1 = await app.inject({ method: 'POST', url: path, headers: first.headers, payload: first.payload });
    const response2 = await app.inject({ method: 'POST', url: path, headers: second.headers, payload: second.payload });

    expect(response1.json()).toMatchObject({ accepted: 1, duplicates: 0 });
    expect(response2.json()).toMatchObject({ accepted: 0, duplicates: 1 });
  });

  it('weist ungueltige Nutzlast mit 400 ab', async () => {
    const body = { events: [{ type: 'X' }] };
    const { headers, payload } = sign('POST', path, body);
    const response = await app.inject({ method: 'POST', url: path, headers, payload });
    expect(response.statusCode).toBe(400);
  });
});

describe('Kommando-Auslieferung', () => {
  it('liefert eingereihte Kommandos genau einmal aus', async () => {
    const games = await store.roblox.listGames('g1');
    await store.roblox.queueCommand({
      gameId: games[0]!.id, type: 'ANNOUNCE', jobId: null, payload: { message: 'Hallo' },
      issuedById: 'u1', guildId: 'g1', confirmedById: 'u1',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const path = '/api/v1/roblox/commands';
    const first = sign('POST', path, { jobId: 'job-1' });
    const response = await app.inject({ method: 'POST', url: path, headers: first.headers, payload: first.payload });
    expect(response.json().commands).toHaveLength(1);

    const second = sign('POST', path, { jobId: 'job-1' });
    const repeat = await app.inject({ method: 'POST', url: path, headers: second.headers, payload: second.payload });
    expect(repeat.json().commands).toHaveLength(0);
  });
});

describe('Health', () => {
  it('meldet Bereitschaft inklusive Treiberangaben', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json().checks.database.driver).toBe('memory');
  });
});
