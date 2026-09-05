import {
  ChannelType,
  DiscordAPIError,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type Message,
  type User,
} from 'discord.js';
import { LIMITS, NexusError, PreconditionError } from '@nexus/shared';

/**
 * Prueft, ob `moderator` das Ziel `target` moderieren darf.
 * Beruecksichtigt Rollenhierarchie, Server-Owner und den Bot selbst.
 */
export function assertModeratable(
  guild: Guild,
  moderator: GuildMember,
  target: GuildMember | null,
  botMember: GuildMember,
): void {
  if (!target) return; // Nutzer ist nicht (mehr) auf dem Server — z. B. Ban per ID.
  if (target.id === moderator.id)
    throw new PreconditionError('Selbstmoderation ist nicht moeglich', { code: 'SELF' });
  if (target.id === guild.client.user?.id)
    throw new PreconditionError('Der Bot kann sich nicht selbst moderieren', { code: 'BOT' });
  if (target.id === guild.ownerId)
    throw new PreconditionError('Der Server-Owner kann nicht moderiert werden', { code: 'OWNER' });

  if (moderator.id !== guild.ownerId && target.roles.highest.position >= moderator.roles.highest.position) {
    throw new PreconditionError('Die Zielperson hat eine gleich hohe oder hoehere Rolle', {
      code: 'HIERARCHY_USER',
    });
  }
  if (target.roles.highest.position >= botMember.roles.highest.position) {
    throw new PreconditionError('Meine Rolle steht nicht ueber der Zielperson', { code: 'HIERARCHY_BOT' });
  }
}

/** Stellt sicher, dass der Bot die noetigen Discord-Rechte besitzt. */
export function assertBotPermission(guild: Guild, permission: bigint, label: string): void {
  const me = guild.members.me;
  if (!me?.permissions.has(permission)) {
    throw new PreconditionError(`Mir fehlt die Discord-Berechtigung "${label}"`, { permission: label });
  }
}

export const MODERATION_PERMISSIONS = {
  ban: { flag: PermissionFlagsBits.BanMembers, label: 'Mitglieder bannen' },
  kick: { flag: PermissionFlagsBits.KickMembers, label: 'Mitglieder kicken' },
  timeout: { flag: PermissionFlagsBits.ModerateMembers, label: 'Mitglieder moderieren' },
  manageMessages: { flag: PermissionFlagsBits.ManageMessages, label: 'Nachrichten verwalten' },
  manageChannels: { flag: PermissionFlagsBits.ManageChannels, label: 'Kanaele verwalten' },
  manageRoles: { flag: PermissionFlagsBits.ManageRoles, label: 'Rollen verwalten' },
  manageNicknames: { flag: PermissionFlagsBits.ManageNicknames, label: 'Nicknames verwalten' },
} as const;

/** Sendet eine DM; Fehlschlaege (geschlossene DMs) sind kein Fehlerfall. */
export async function tryDirectMessage(user: User, content: Parameters<User['send']>[0]): Promise<boolean> {
  try {
    await user.send(content);
    return true;
  } catch {
    return false;
  }
}

/**
 * Loescht Nachrichten unter Beachtung des 14-Tage-Limits der Discord-API.
 * Aeltere Nachrichten koennen nicht per Bulk-Delete entfernt werden.
 */
export async function bulkDelete(
  channel: GuildTextBasedChannel,
  messages: Message[],
): Promise<{ deleted: number; skippedTooOld: number }> {
  const cutoff = Date.now() - LIMITS.bulkDeleteMaxAgeDays * 24 * 60 * 60 * 1000;
  const deletable = messages.filter((message) => message.createdTimestamp > cutoff && !message.pinned);
  const skippedTooOld = messages.length - deletable.length;

  let deleted = 0;
  for (let index = 0; index < deletable.length; index += LIMITS.bulkDeleteMax) {
    const batch = deletable.slice(index, index + LIMITS.bulkDeleteMax);
    try {
      const removed = await channel.bulkDelete(batch, true);
      deleted += removed.size;
    } catch (error) {
      if (error instanceof DiscordAPIError && error.code === 50034) continue;
      throw error;
    }
  }
  return { deleted, skippedTooOld };
}

/** Kanaele, in denen Nachrichten gesendet werden koennen. */
export function isTextChannel(channel: { type: ChannelType } | null): boolean {
  return (
    channel !== null &&
    [
      ChannelType.GuildText,
      ChannelType.GuildAnnouncement,
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
    ].includes(channel.type)
  );
}

/** Wandelt Discord-API-Fehler in verstaendliche NEXUS-Fehler um (Regel 40). */
export function wrapDiscordError(error: unknown, action: string): NexusError {
  if (error instanceof DiscordAPIError) {
    const messages: Record<number, string> = {
      10007: 'Das Mitglied ist nicht (mehr) auf dem Server.',
      10013: 'Der Nutzer existiert nicht.',
      10026: 'Dieser Nutzer ist nicht gebannt.',
      50001: 'Mir fehlt der Zugriff auf diese Ressource.',
      50013: 'Mir fehlen die noetigen Berechtigungen.',
      50035: 'Discord hat die Eingabe abgelehnt (ungueltige Werte).',
    };
    const message = messages[Number(error.code)] ?? `Discord-Fehler ${error.code}: ${error.message}`;
    return new NexusError(message, {
      code: 'UPSTREAM_UNAVAILABLE',
      status: 502,
      expected: true,
      meta: { action, discordCode: error.code },
      cause: error,
    });
  }
  return new NexusError(`Aktion "${action}" fehlgeschlagen`, { cause: error });
}
