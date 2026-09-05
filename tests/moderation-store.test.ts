import { describe, expect, it } from 'vitest';
import { MemoryDataStore, defaultGuildConfig } from '@nexus/database';

describe('Moderationsspeicher', () => {
  it('vergibt lueckenlose, eindeutige Fallnummern je Server', async () => {
    const store = new MemoryDataStore();
    const created = await Promise.all(
      Array.from({ length: 25 }, () =>
        store.moderation.createCase({
          guildId: 'g1', action: 'WARN', targetId: 't1', moderatorId: 'm1', reason: 'Test',
        }),
      ),
    );
    const sequences = created.map((entry) => entry.sequence).sort((a, b) => a - b);
    expect(sequences).toEqual(Array.from({ length: 25 }, (_unused, index) => index + 1));
    expect(new Set(created.map((entry) => entry.caseId)).size).toBe(25);
  });

  it('zaehlt Fallnummern je Server getrennt', async () => {
    const store = new MemoryDataStore();
    const first = await store.moderation.createCase({
      guildId: 'g1', action: 'WARN', targetId: 't', moderatorId: 'm', reason: 'x',
    });
    const second = await store.moderation.createCase({
      guildId: 'g2', action: 'WARN', targetId: 't', moderatorId: 'm', reason: 'x',
    });
    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(1);
    expect(first.caseId).not.toBe(second.caseId);
  });

  it('findet Faelle ueber die Fall-ID und filtert nach Ziel', async () => {
    const store = new MemoryDataStore();
    const entry = await store.moderation.createCase({
      guildId: 'g1', action: 'BAN', targetId: 'opfer', moderatorId: 'm1', reason: 'Scam',
    });
    expect((await store.moderation.getCase('g1', entry.caseId))?.reason).toBe('Scam');
    expect((await store.moderation.getCase('g2', entry.caseId))).toBeNull();

    await store.moderation.createCase({
      guildId: 'g1', action: 'WARN', targetId: 'jemand', moderatorId: 'm1', reason: 'Spam',
    });
    const filtered = await store.moderation.listCases('g1', { targetId: 'opfer' });
    expect(filtered.total).toBe(1);
  });

  it('liefert nur wirklich abgelaufene Massnahmen', async () => {
    const store = new MemoryDataStore();
    await store.moderation.createCase({
      guildId: 'g1', action: 'BAN', targetId: 't1', moderatorId: 'm1', reason: 'temp',
      durationMs: 1_000, expiresAt: new Date(Date.now() - 1_000),
    });
    await store.moderation.createCase({
      guildId: 'g1', action: 'BAN', targetId: 't2', moderatorId: 'm1', reason: 'lang',
      durationMs: 86_400_000, expiresAt: new Date(Date.now() + 86_400_000),
    });
    const expired = await store.moderation.listExpiredCases(new Date());
    expect(expired).toHaveLength(1);
    expect(expired[0]?.targetId).toBe('t1');
  });

  it('deaktiviert Verwarnungen genau einmal', async () => {
    const store = new MemoryDataStore();
    const warning = await store.moderation.addWarning({
      guildId: 'g1', targetId: 't1', moderatorId: 'm1', reason: 'Spam',
    });
    expect(await store.moderation.deactivateWarning(warning.id)).toBe(true);
    expect(await store.moderation.deactivateWarning(warning.id)).toBe(false);
    expect(await store.moderation.listWarnings('g1', 't1')).toHaveLength(0);
  });
});

describe('Guild-Konfiguration', () => {
  it('liefert sichere Standardwerte', () => {
    const config = defaultGuildConfig('g1');
    expect(config.automodEnabled).toBe(true);
    expect(config.antiNukeEnabled).toBe(true);
    expect(config.lockdownActive).toBe(false);
    expect(config.automodConfig.ANTI_PHISHING?.enabled).toBe(true);
  });

  it('behaelt nicht gesetzte Felder bei Teilaktualisierungen', async () => {
    const store = new MemoryDataStore();
    await store.guilds.updateConfig('g1', { modLogChannelId: 'c1' });
    const config = await store.guilds.updateConfig('g1', { automodEnabled: false });
    expect(config.modLogChannelId).toBe('c1');
    expect(config.automodEnabled).toBe(false);
  });
});

describe('Roblox-Verknuepfung', () => {
  it('verhindert doppelte Verknuepfung eines Roblox-Kontos', async () => {
    const store = new MemoryDataStore();
    await store.roblox.linkAccount({
      userId: 'd1', discordId: 'd1', robloxUserId: 'r1', username: 'Spieler',
    });
    await expect(
      store.roblox.linkAccount({ userId: 'd2', discordId: 'd2', robloxUserId: 'r1', username: 'Spieler' }),
    ).rejects.toThrow();
  });

  it('nimmt jedes Roblox-Event nur einmal an', async () => {
    const store = new MemoryDataStore();
    const game = await store.roblox.upsertGame({
      guildId: 'g1', universeId: 'u1', placeId: null, name: 'Spiel', iconUrl: null,
      signingSecretHash: 'hash', secretHint: 'nxs_', active: true, settings: {},
    });
    const payload = {
      gameId: game.id, eventId: 'evt-1', type: 'PLAYER_JOIN', jobId: 'job',
      robloxUserId: 'r1', payload: {}, occurredAt: new Date(),
    };
    expect((await store.roblox.recordEvent(payload)).duplicate).toBe(false);
    expect((await store.roblox.recordEvent(payload)).duplicate).toBe(true);
  });

  it('liefert ein Kommando nur an einen Abholer aus', async () => {
    const store = new MemoryDataStore();
    const game = await store.roblox.upsertGame({
      guildId: 'g1', universeId: 'u1', placeId: null, name: 'Spiel', iconUrl: null,
      signingSecretHash: 'hash', secretHint: 'nxs_', active: true, settings: {},
    });
    await store.roblox.queueCommand({
      gameId: game.id, type: 'ANNOUNCE', jobId: null, payload: { message: 'Hi' },
      issuedById: 'u1', guildId: 'g1', confirmedById: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const first = await store.roblox.claimCommands(game.id, 'job-1');
    const second = await store.roblox.claimCommands(game.id, 'job-2');
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });
});
