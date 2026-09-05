import { ForbiddenError } from '@nexus/shared';
import { PERMISSION_NODES, type PermissionNode } from './nodes.js';

export interface PermissionSubject {
  userId: string;
  guildId?: string;
  roleIds: string[];
  /** Discord-Guild-Owner oder Bot-Owner. */
  isGuildOwner?: boolean;
  isBotOwner?: boolean;
  /** Discord-Administrator-Flag (Fallback, wenn NEXUS-Rollen fehlen). */
  hasDiscordAdmin?: boolean;
}

export interface PermissionGrant {
  /** Discord-Rollen-ID oder User-ID. */
  subjectId: string;
  subjectType: 'role' | 'user';
  /** Explizit erlaubte Knoten (Wildcards erlaubt). */
  allow: string[];
  /** Explizite Verbote — haben Vorrang vor Erlaubnissen. */
  deny: string[];
}

export interface PermissionDecision {
  allowed: boolean;
  reason: 'BOT_OWNER' | 'GUILD_OWNER' | 'GRANT' | 'DISCORD_ADMIN' | 'DENY_RULE' | 'NO_GRANT';
  matchedRule?: string;
}

/** Prueft einen Knoten gegen ein Muster mit Wildcard-Unterstuetzung. */
export function matchesNode(pattern: string, node: string): boolean {
  if (pattern === '*') return true;
  if (pattern === node) return true;
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2);
    return node === prefix || node.startsWith(`${prefix}.`);
  }
  return false;
}

export function isValidNode(node: string): node is PermissionNode {
  return (PERMISSION_NODES as readonly string[]).includes(node);
}

/**
 * Wertet Berechtigungen aus.
 *
 * Reihenfolge (erste Uebereinstimmung gewinnt):
 *   1. Bot-Owner    -> immer erlaubt
 *   2. Explizites DENY (Rolle oder User)
 *   3. Guild-Owner  -> immer erlaubt
 *   4. Explizites ALLOW
 *   5. Discord-Administrator-Fallback (nur wenn `allowDiscordAdminFallback`)
 *   6. Verweigert
 */
export class PermissionService {
  constructor(private readonly allowDiscordAdminFallback = true) {}

  evaluate(subject: PermissionSubject, node: PermissionNode, grants: PermissionGrant[]): PermissionDecision {
    if (subject.isBotOwner) return { allowed: true, reason: 'BOT_OWNER' };

    const relevant = grants.filter(
      (grant) =>
        (grant.subjectType === 'user' && grant.subjectId === subject.userId) ||
        (grant.subjectType === 'role' && subject.roleIds.includes(grant.subjectId)),
    );

    for (const grant of relevant) {
      const denied = grant.deny.find((pattern) => matchesNode(pattern, node));
      if (denied) return { allowed: false, reason: 'DENY_RULE', matchedRule: denied };
    }

    if (subject.isGuildOwner) return { allowed: true, reason: 'GUILD_OWNER' };

    for (const grant of relevant) {
      const allowed = grant.allow.find((pattern) => matchesNode(pattern, node));
      if (allowed) return { allowed: true, reason: 'GRANT', matchedRule: allowed };
    }

    if (this.allowDiscordAdminFallback && subject.hasDiscordAdmin && !node.startsWith('dashboard.developers')) {
      return { allowed: true, reason: 'DISCORD_ADMIN' };
    }

    return { allowed: false, reason: 'NO_GRANT' };
  }

  assert(subject: PermissionSubject, node: PermissionNode, grants: PermissionGrant[]): void {
    const decision = this.evaluate(subject, node, grants);
    if (!decision.allowed) {
      throw new ForbiddenError(`Fehlende Berechtigung: ${node}`, {
        node,
        reason: decision.reason,
        userId: subject.userId,
        guildId: subject.guildId,
      });
    }
  }

  /** Alle effektiven Knoten eines Subjekts (fuer Dashboard/UI). */
  resolve(subject: PermissionSubject, grants: PermissionGrant[]): PermissionNode[] {
    return PERMISSION_NODES.filter((node) => this.evaluate(subject, node, grants).allowed);
  }
}

export const permissions = new PermissionService();
