import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryDataStore, levelFromTotalXp, xpForLevel } from '@nexus/database';
import { PreconditionError } from '@nexus/shared';

/**
 * Die Wirtschaft ist der Bereich mit dem hoechsten Missbrauchsrisiko
 * (Regel 13/29): keine Doppelbuchungen, keine negativen Salden, keine
 * verlorenen Betraege bei parallelen Anfragen.
 */
describe('Wirtschaft', () => {
  let store: MemoryDataStore;
  const guildId = 'g1';

  beforeEach(async () => {
    store = new MemoryDataStore();
    await store.economy.mutate({
      guildId, userId: 'u1', target: 'wallet', amount: 1_000,
      type: 'ADMIN_ADJUST', reason: 'Start', idempotencyKey: 'start:u1',
    });
  });

  it('bucht Betraege und protokolliert die Transaktion', async () => {
    const result = await store.economy.mutate({
      guildId, userId: 'u1', target: 'wallet', amount: 250, type: 'WORK', reason: 'Arbeit',
    });
    expect(result.profile.wallet).toBe(1_250);
    expect(result.transaction?.amount).toBe(250);
  });

  it('verhindert Ueberziehung', async () => {
    await expect(
      store.economy.mutate({ guildId, userId: 'u1', target: 'wallet', amount: -5_000, type: 'SHOP_BUY' }),
    ).rejects.toBeInstanceOf(PreconditionError);
    const profile = await store.economy.getProfile(guildId, 'u1');
    expect(profile.wallet).toBe(1_000);
  });

  it('bucht denselben Idempotenzschluessel nur einmal', async () => {
    const key = 'daily:2026-01-01:u1';
    await store.economy.mutate({ guildId, userId: 'u1', target: 'wallet', amount: 500, type: 'DAILY', idempotencyKey: key });
    await store.economy.mutate({ guildId, userId: 'u1', target: 'wallet', amount: 500, type: 'DAILY', idempotencyKey: key });
    const profile = await store.economy.getProfile(guildId, 'u1');
    expect(profile.wallet).toBe(1_500);
  });

  it('haelt die Summe bei Transfers konstant', async () => {
    await store.economy.mutate({ guildId, userId: 'u2', target: 'wallet', amount: 300, type: 'ADMIN_ADJUST' });
    const before =
      (await store.economy.getProfile(guildId, 'u1')).wallet + (await store.economy.getProfile(guildId, 'u2')).wallet;

    await store.economy.transfer({ guildId, fromUserId: 'u1', toUserId: 'u2', amount: 400 });

    const from = await store.economy.getProfile(guildId, 'u1');
    const to = await store.economy.getProfile(guildId, 'u2');
    expect(from.wallet).toBe(600);
    expect(to.wallet).toBe(700);
    expect(from.wallet + to.wallet).toBe(before);
  });

  it('lehnt Transfers ohne Deckung ab', async () => {
    await expect(
      store.economy.transfer({ guildId, fromUserId: 'u1', toUserId: 'u2', amount: 99_999 }),
    ).rejects.toBeInstanceOf(PreconditionError);
    expect((await store.economy.getProfile(guildId, 'u1')).wallet).toBe(1_000);
  });

  it('lehnt Selbsttransfer und nicht positive Betraege ab', async () => {
    await expect(store.economy.transfer({ guildId, fromUserId: 'u1', toUserId: 'u1', amount: 10 })).rejects.toThrow();
    await expect(store.economy.transfer({ guildId, fromUserId: 'u1', toUserId: 'u2', amount: 0 })).rejects.toThrow();
  });

  it('verliert bei parallelen Buchungen nichts', async () => {
    // Node ist single-threaded; entscheidend ist, dass jede Buchung den
    // aktuellen Stand liest und nicht einen zwischengespeicherten.
    await Promise.all(
      Array.from({ length: 20 }, (_unused, index) =>
        store.economy.mutate({
          guildId, userId: 'u1', target: 'wallet', amount: 10,
          type: 'REWARD', idempotencyKey: `parallel:${index}`,
        }),
      ),
    );
    expect((await store.economy.getProfile(guildId, 'u1')).wallet).toBe(1_200);
  });

  it('begrenzt Einzahlungen auf die Bankkapazitaet', async () => {
    await expect(
      store.economy.mutate({ guildId, userId: 'u1', target: 'bank', amount: 999_999, type: 'DEPOSIT' }),
    ).rejects.toBeInstanceOf(PreconditionError);
  });
});

describe('Belohnungen (plattformuebergreifend)', () => {
  it('vergibt jede Belohnung nur einmal', async () => {
    const store = new MemoryDataStore();
    const input = {
      userId: 'u1', guildId: 'g1', idempotencyKey: 'quest:1:u1',
      kind: 'discord_coins' as const, amount: 100, reference: 'quest-1', source: 'roblox:1',
    };
    const first = await store.rewards.grant(input);
    const second = await store.rewards.grant(input);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.grant.id).toBe(first.grant.id);
  });
});

describe('Level-Mathematik', () => {
  it('steigt monoton', () => {
    expect(xpForLevel(1)).toBeGreaterThan(xpForLevel(0));
    expect(xpForLevel(50)).toBeGreaterThan(xpForLevel(49));
  });

  it('ist die Umkehrung der Gesamt-XP', () => {
    let total = 0;
    for (let level = 0; level < 25; level++) {
      total += xpForLevel(level);
      expect(levelFromTotalXp(total).level).toBe(level + 1);
    }
  });

  it('meldet Restfortschritt korrekt', () => {
    const result = levelFromTotalXp(xpForLevel(0) + 30);
    expect(result.level).toBe(1);
    expect(result.xpIntoLevel).toBe(30);
  });
});
