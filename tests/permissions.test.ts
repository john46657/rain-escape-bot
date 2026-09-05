import { describe, expect, it } from 'vitest';
import { PermissionService, type PermissionGrant } from '@nexus/permissions';

const service = new PermissionService();

const subject = (overrides: Partial<Parameters<typeof service.evaluate>[0]> = {}) => ({
  userId: 'u1',
  guildId: 'g1',
  roleIds: [] as string[],
  isGuildOwner: false,
  hasDiscordAdmin: false,
  isBotOwner: false,
  ...overrides,
});

describe('Berechtigungsauswertung', () => {
  it('erlaubt dem Bot-Owner alles', () => {
    expect(service.evaluate(subject({ isBotOwner: true }), 'roblox.server.shutdown', []).allowed).toBe(true);
  });

  it('erlaubt dem Guild-Owner alles im eigenen Server', () => {
    expect(service.evaluate(subject({ isGuildOwner: true }), 'discord.moderation.ban', []).allowed).toBe(
      true,
    );
  });

  it('verweigert ohne jede Zuweisung', () => {
    const result = service.evaluate(subject(), 'discord.moderation.ban', []);
    expect(result.allowed).toBe(false);
  });

  it('erlaubt ueber eine explizite Rollenzuweisung', () => {
    const grants: PermissionGrant[] = [
      { subjectId: 'r1', subjectType: 'role', allow: ['discord.moderation.ban'], deny: [] },
    ];
    expect(service.evaluate(subject({ roleIds: ['r1'] }), 'discord.moderation.ban', grants).allowed).toBe(
      true,
    );
  });

  it('unterstuetzt Wildcards', () => {
    const grants: PermissionGrant[] = [
      { subjectId: 'r1', subjectType: 'role', allow: ['discord.moderation.*'], deny: [] },
    ];
    expect(service.evaluate(subject({ roleIds: ['r1'] }), 'discord.moderation.kick', grants).allowed).toBe(
      true,
    );
    expect(service.evaluate(subject({ roleIds: ['r1'] }), 'roblox.server.shutdown', grants).allowed).toBe(
      false,
    );
  });

  it('laesst DENY immer vor ALLOW gewinnen', () => {
    const grants: PermissionGrant[] = [
      { subjectId: 'r1', subjectType: 'role', allow: ['discord.moderation.*'], deny: [] },
      { subjectId: 'u1', subjectType: 'user', allow: [], deny: ['discord.moderation.ban'] },
    ];
    const result = service.evaluate(subject({ roleIds: ['r1'] }), 'discord.moderation.ban', grants);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('DENY_RULE');
  });

  it('schlaegt DENY auch den Discord-Administrator', () => {
    const grants: PermissionGrant[] = [
      { subjectId: 'u1', subjectType: 'user', allow: [], deny: ['discord.moderation.ban'] },
    ];
    expect(
      service.evaluate(subject({ hasDiscordAdmin: true }), 'discord.moderation.ban', grants).allowed,
    ).toBe(false);
  });

  it('gewaehrt Discord-Administratoren die Standardrechte', () => {
    expect(service.evaluate(subject({ hasDiscordAdmin: true }), 'discord.moderation.ban', []).allowed).toBe(
      true,
    );
  });

  it('sperrt Entwicklerfunktionen fuer reine Discord-Administratoren', () => {
    const result = service.evaluate(subject({ hasDiscordAdmin: true }), 'dashboard.developers.manage', []);
    expect(result.allowed).toBe(false);
  });

  it('loest alle effektiven Knoten auf', () => {
    const grants: PermissionGrant[] = [
      { subjectId: 'r1', subjectType: 'role', allow: ['discord.tickets.claim'], deny: [] },
    ];
    const nodes = service.resolve(subject({ roleIds: ['r1'] }), grants);
    expect(nodes).toContain('discord.tickets.claim');
    expect(nodes).not.toContain('discord.moderation.ban');
  });
});
