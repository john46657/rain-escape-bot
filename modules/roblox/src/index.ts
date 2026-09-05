import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import {
  embeds,
  requireConfirmation,
  truncate,
  writeAudit,
  type NexusModule,
  type Services,
  type SlashCommand,
} from '@nexus/bot-core';
import { MINUTE, PreconditionError, discordTimestamp, uuid } from '@nexus/shared';
import { VerificationService } from './verification.js';

/**
 * Modul: Roblox (Regeln 19-27).
 * Verifizierung, Profil, Server-Monitor, Fernsteuerung und Gruppen-Sync.
 */

const verify: SlashCommand = {
  category: 'roblox',
  moduleToggle: 'robloxEnabled',
  cooldownMs: 30_000,
  guildOnly: false,
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Verknuepft dein Roblox-Konto mit Discord')
    .setDescriptionLocalizations({ 'en-US': 'Links your Roblox account with Discord' }),
  execute: async ({ interaction, services, t }) => {
    await interaction.deferReply({ ephemeral: true });
    const service = new VerificationService(services);

    const existing = await services.store.roblox.getAccountByDiscordId(interaction.user.id);
    if (existing) {
      await interaction.editReply({
        embeds: [embeds.warning(t('verification.alreadyLinked', { username: existing.username }))],
      });
      return;
    }

    const ticket = await service.createTicket(interaction.user.id, interaction.guildId);
    const games = interaction.guildId ? await services.store.roblox.listGames(interaction.guildId) : [];

    await interaction.editReply({
      embeds: [
        embeds
          .primary(
            t('verification.codeTitle'),
            t('verification.codeBody', {
              code: ticket.code,
              expires: discordTimestamp(ticket.expiresAt, 'R'),
            }),
          )
          .addFields({
            name: 'Verbundene Spiele',
            value:
              games.length > 0
                ? games.map((game) => `• **${game.name}** (Universe \`${game.universeId}\`)`).join('\n')
                : 'Fuer diesen Server ist noch kein Spiel konfiguriert — frag die Serverleitung.',
          })
          .setFooter({
            text: 'Teile diesen Code mit niemandem. NEXUS fragt nie nach deinem Roblox-Passwort.',
          }),
      ],
    });
  },
};

const unlink: SlashCommand = {
  category: 'roblox',
  moduleToggle: 'robloxEnabled',
  guildOnly: false,
  cooldownMs: 10_000,
  data: new SlashCommandBuilder()
    .setName('unlink')
    .setDescription('Loest die Verknuepfung mit deinem Roblox-Konto'),
  execute: async ({ interaction, services, t }) => {
    const account = await services.store.roblox.getAccountByDiscordId(interaction.user.id);
    if (!account) {
      await interaction.reply({ embeds: [embeds.warning(t('verification.notLinked'))], ephemeral: true });
      return;
    }

    const confirmed = await requireConfirmation(interaction, {
      title: 'Verknuepfung loesen',
      description: `Die Verbindung zu **${account.username}** wird entfernt. Verifizierte Rollen gehen verloren.`,
      confirmLabel: 'Trennen',
      cancelLabel: t('common.cancel'),
    });
    if (!confirmed) return;

    await services.store.roblox.unlinkAccount(interaction.user.id);
    await writeAudit(services, {
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      actorType: 'discord',
      action: 'roblox.unlink',
      targetId: account.robloxUserId,
      targetType: 'roblox_user',
      result: 'SUCCESS',
      reason: null,
      metadata: { username: account.username },
    });

    // Verifizierte Rolle entziehen, damit der Zustand konsistent bleibt.
    if (interaction.guildId) {
      const config = await services.guildContext.config(interaction.guildId);
      const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
      if (member && config.verifiedRoleId) {
        await member.roles
          .remove(config.verifiedRoleId, 'NEXUS: Verknuepfung geloest')
          .catch(() => undefined);
      }
    }

    await interaction.editReply({
      embeds: [embeds.success(t('verification.unlinked', { username: account.username }))],
      components: [],
    });
  },
};

const roblox: SlashCommand = {
  category: 'roblox',
  moduleToggle: 'robloxEnabled',
  cooldownMs: 3_000,
  data: new SlashCommandBuilder()
    .setName('roblox')
    .setDescription('Roblox-Integration')
    .addSubcommand((sub) =>
      sub
        .setName('profile')
        .setDescription('Zeigt das verknuepfte Roblox-Profil')
        .addUserOption((option) => option.setName('user').setDescription('Discord-Nutzer')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('lookup')
        .setDescription('Sucht ein Roblox-Konto')
        .addStringOption((option) =>
          option.setName('username').setDescription('Roblox-Benutzername').setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('servers').setDescription('Zeigt die laufenden Spielserver'))
    .addSubcommand((sub) =>
      sub
        .setName('announce')
        .setDescription('Sendet eine Nachricht in alle laufenden Spielserver')
        .addStringOption((option) =>
          option.setName('message').setDescription('Nachricht').setRequired(true).setMaxLength(200),
        )
        .addStringOption((option) => option.setName('game').setDescription('Universe-ID (leer = alle)')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('kick')
        .setDescription('Kickt einen Spieler aus dem Spiel')
        .addStringOption((option) =>
          option.setName('roblox_user').setDescription('Roblox-Benutzername').setRequired(true),
        )
        .addStringOption((option) => option.setName('reason').setDescription('Grund').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('ban')
        .setDescription('Sperrt einen Spieler im Spiel')
        .addStringOption((option) =>
          option.setName('roblox_user').setDescription('Roblox-Benutzername').setRequired(true),
        )
        .addStringOption((option) => option.setName('reason').setDescription('Grund').setRequired(true))
        .addStringOption((option) =>
          option.setName('duration').setDescription('Dauer, z. B. 7d (leer = permanent)'),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('shutdown')
        .setDescription('Faehrt eine Serverinstanz kontrolliert herunter')
        .addStringOption((option) =>
          option.setName('job_id').setDescription('JobId der Instanz').setRequired(true),
        )
        .addStringOption((option) => option.setName('reason').setDescription('Grund').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub.setName('groupsync').setDescription('Synchronisiert Gruppenraenge mit Discord-Rollen'),
    ),
  execute: async (ctx) => {
    const { interaction, services, t } = ctx;
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId!;

    switch (sub) {
      case 'profile': {
        const user = interaction.options.getUser('user') ?? interaction.user;
        const account = await services.store.roblox.getAccountByDiscordId(user.id);
        if (!account) {
          await interaction.reply({ embeds: [embeds.warning(t('verification.notLinked'))], ephemeral: true });
          return;
        }
        await interaction.deferReply();
        const [profile, groups] = await Promise.all([
          services.roblox.getUser(account.robloxUserId).catch(() => null),
          services.roblox.getUserGroups(account.robloxUserId).catch(() => []),
        ]);
        await interaction.editReply({
          embeds: [
            embeds
              .primary(
                t('verification.profileTitle'),
                `**${account.username}** (\`${account.robloxUserId}\`)`,
              )
              .setThumbnail(account.avatarUrl)
              .setURL(`https://www.roblox.com/users/${account.robloxUserId}/profile`)
              .addFields(
                { name: 'Discord', value: `<@${user.id}>`, inline: true },
                { name: 'Verifiziert', value: discordTimestamp(account.verifiedAt, 'R'), inline: true },
                {
                  name: 'Anzeigename',
                  value: profile?.displayName ?? account.displayName ?? '—',
                  inline: true,
                },
                {
                  name: `Gruppen (${groups.length})`,
                  value:
                    truncate(
                      groups
                        .slice(0, 8)
                        .map(
                          (entry) => `• ${entry.group.name} — ${entry.role.name} (Rang ${entry.role.rank})`,
                        )
                        .join('\n'),
                      1024,
                    ) || '—',
                },
              ),
          ],
        });
        return;
      }

      case 'lookup': {
        await ctx.requirePermission('roblox.view');
        const username = interaction.options.getString('username', true);
        await interaction.deferReply();
        const profile = await services.roblox.getUserByUsername(username);
        if (!profile) {
          await interaction.editReply({ embeds: [embeds.warning(t('roblox.playerNotFound'))] });
          return;
        }
        const linked = await services.store.roblox.getAccountByRobloxId(String(profile.id));
        await interaction.editReply({
          embeds: [
            embeds
              .primary(profile.name, profile.description?.slice(0, 400) || '—')
              .setURL(`https://www.roblox.com/users/${profile.id}/profile`)
              .setThumbnail(await services.roblox.getAvatarUrl(String(profile.id)).catch(() => null))
              .addFields(
                { name: 'Roblox-ID', value: `\`${profile.id}\``, inline: true },
                { name: 'Anzeigename', value: profile.displayName, inline: true },
                {
                  name: 'Discord',
                  value: linked ? `<@${linked.discordId}>` : 'nicht verknuepft',
                  inline: true,
                },
              ),
          ],
        });
        return;
      }

      case 'servers': {
        await ctx.requirePermission('roblox.view');
        const games = await services.store.roblox.listGames(guildId);
        if (games.length === 0) {
          await interaction.reply({ embeds: [embeds.warning(t('roblox.notConfigured'))], ephemeral: true });
          return;
        }
        await interaction.deferReply();
        const lines: string[] = [];
        let totalPlayers = 0;
        for (const game of games) {
          const servers = await services.store.roblox.listServers(game.id);
          const online = servers.filter((server) => server.status === 'online');
          totalPlayers += online.reduce((sum, server) => sum + server.playerCount, 0);
          lines.push(
            `**${game.name}** — ${online.length} Instanz(en)\n` +
              (online
                .slice(0, 6)
                .map(
                  (server) =>
                    `\`${server.jobId.slice(0, 8)}\` ${server.playerCount}/${server.maxPlayers} Spieler · ` +
                    `${server.fps ? `${Math.round(server.fps)} FPS · ` : ''}${discordTimestamp(server.lastHeartbeatAt, 'R')}`,
                )
                .join('\n') || '_keine aktive Instanz_'),
          );
        }
        await interaction.editReply({
          embeds: [
            embeds
              .primary(t('roblox.serverListTitle'), lines.join('\n\n'))
              .setFooter({ text: `${totalPlayers} Spieler online` }),
          ],
        });
        return;
      }

      case 'announce': {
        await ctx.requirePermission('roblox.server.announce');
        const message = interaction.options.getString('message', true);
        const universeId = interaction.options.getString('game');
        await interaction.deferReply();
        const count = await queueForGames(ctx, guildId, universeId, 'ANNOUNCE', {
          message,
          author: interaction.user.tag,
        });
        await interaction.editReply({ embeds: [embeds.success(t('roblox.announceQueued', { count }))] });
        return;
      }

      case 'kick': {
        await ctx.requirePermission('roblox.moderation.kick');
        const username = interaction.options.getString('roblox_user', true);
        const reason = interaction.options.getString('reason', true);
        await interaction.deferReply();
        const profile = await services.roblox.getUserByUsername(username);
        if (!profile) throw new PreconditionError(t('roblox.playerNotFound'));
        const count = await queueForGames(ctx, guildId, null, 'KICK_PLAYER', {
          robloxUserId: String(profile.id),
          reason,
        });
        await interaction.editReply({
          embeds: [embeds.success(`Kick fuer **${profile.name}** an ${count} Instanz(en) uebermittelt.`)],
        });
        return;
      }

      case 'ban': {
        await ctx.requirePermission('roblox.moderation.ban');
        const username = interaction.options.getString('roblox_user', true);
        const reason = interaction.options.getString('reason', true);
        const duration = interaction.options.getString('duration');
        const profile = await services.roblox.getUserByUsername(username);
        if (!profile) throw new PreconditionError(t('roblox.playerNotFound'));

        const confirmed = await requireConfirmation(interaction, {
          title: 'Roblox-Bann bestaetigen',
          description:
            `**${profile.name}** (\`${profile.id}\`) wird im Spiel gesperrt.\n` +
            `**Grund:** ${reason}\n**Dauer:** ${duration ?? 'permanent'}`,
          confirmLabel: 'Sperren',
          cancelLabel: t('common.cancel'),
        });
        if (!confirmed) return;

        const count = await queueForGames(ctx, guildId, null, 'BAN_PLAYER', {
          robloxUserId: String(profile.id),
          reason,
          duration: duration ?? null,
        });
        await interaction.editReply({
          embeds: [embeds.success(`Bann fuer **${profile.name}** an ${count} Instanz(en) uebermittelt.`)],
          components: [],
        });
        return;
      }

      case 'shutdown': {
        // Hoechste Eskalationsstufe: eigene Berechtigung + Bestaetigung (Regel 22).
        await ctx.requirePermission('roblox.server.shutdown');
        const jobId = interaction.options.getString('job_id', true);
        const reason = interaction.options.getString('reason', true);

        const confirmed = await requireConfirmation(interaction, {
          title: '⚠️ Serverinstanz herunterfahren',
          description: `Instanz \`${jobId}\` wird beendet. Alle Spieler werden getrennt.\n**Grund:** ${reason}`,
          confirmLabel: 'Herunterfahren',
          cancelLabel: t('common.cancel'),
        });
        if (!confirmed) return;

        const count = await queueForGames(ctx, guildId, null, 'SHUTDOWN', { reason }, jobId);
        await interaction.editReply({
          embeds: [embeds.success(`Shutdown-Befehl an ${count} Instanz(en) uebermittelt.`)],
          components: [],
        });
        return;
      }

      default: {
        await ctx.requirePermission('roblox.groups.sync');
        await interaction.deferReply();
        const service = new VerificationService(services);
        const guild = interaction.guild!;
        const members = await guild.members.fetch();
        let updated = 0;

        for (const member of members.values()) {
          const account = await services.store.roblox.getAccountByDiscordId(member.id);
          if (!account) continue;
          updated += await service.syncGroupRoles(guild, member, account);
        }

        await writeAudit(services, {
          guildId,
          actorId: interaction.user.id,
          actorType: 'discord',
          action: 'roblox.group.sync',
          targetId: guildId,
          targetType: 'guild',
          result: 'SUCCESS',
          reason: null,
          metadata: { updated },
        });
        await interaction.editReply({
          embeds: [embeds.success(t('roblox.groupSynced', { count: updated }))],
        });
      }
    }
  },
};

/**
 * Stellt ein Kommando fuer die betroffenen Spiele in die Warteschlange.
 * Der Game-Server holt es beim naechsten Poll ab (Regel 25) — dadurch
 * funktioniert die Fernsteuerung auch ohne Open-Cloud-Zugang.
 */
async function queueForGames(
  ctx: { services: Services; interaction: { user: { id: string } } },
  guildId: string,
  universeId: string | null,
  type: string,
  payload: Record<string, unknown>,
  jobId?: string,
): Promise<number> {
  const { services } = ctx;
  const games = (await services.store.roblox.listGames(guildId)).filter(
    (game) => game.active && (!universeId || game.universeId === universeId),
  );
  if (games.length === 0) throw new PreconditionError('Kein aktives Roblox-Spiel konfiguriert');

  let queued = 0;
  for (const game of games) {
    const command = await services.store.roblox.queueCommand({
      gameId: game.id,
      type,
      jobId: jobId ?? null,
      payload: { ...payload, nonce: uuid() },
      issuedById: ctx.interaction.user.id,
      guildId,
      confirmedById: ctx.interaction.user.id,
      expiresAt: new Date(Date.now() + 5 * MINUTE),
    });
    queued++;

    // Wenn ein Open-Cloud-Key vorhanden ist, zusaetzlich sofort pushen.
    if (services.roblox.hasOpenCloudAccess) {
      await services.roblox
        .publishMessage(game.universeId, 'nexus:commands', { commandId: command.id, type, payload })
        .catch((error: unknown) =>
          services.log.warn('MessagingService-Push fehlgeschlagen — Fallback auf Polling', {
            gameId: game.id,
            error: String(error),
          }),
        );
    }

    await writeAudit(services, {
      guildId,
      actorId: ctx.interaction.user.id,
      actorType: 'discord',
      action: `roblox.command.${type.toLowerCase()}`,
      targetId: game.id,
      targetType: 'roblox_game',
      result: 'SUCCESS',
      reason: String(payload['reason'] ?? ''),
      metadata: { commandId: command.id, jobId },
    });
  }
  return queued;
}

const robloxAdmin: SlashCommand = {
  category: 'roblox',
  permission: 'roblox.games.manage',
  moduleToggle: 'robloxEnabled',
  data: new SlashCommandBuilder()
    .setName('robloxgame')
    .setDescription('Verwaltet verbundene Roblox-Spiele')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) => sub.setName('list').setDescription('Zeigt verbundene Spiele'))
    .addSubcommand((sub) =>
      sub
        .setName('link')
        .setDescription('Verbindet ein Roblox-Universum (Secret wird per DM gesendet)')
        .addStringOption((option) =>
          option.setName('universe_id').setDescription('Universe-ID').setRequired(true),
        )
        .addStringOption((option) => option.setName('name').setDescription('Anzeigename').setRequired(true)),
    ),
  execute: async ({ interaction, services }) => {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId!;

    if (sub === 'list') {
      const games = await services.store.roblox.listGames(guildId);
      await interaction.reply({
        embeds: [
          embeds.primary(
            'Verbundene Spiele',
            games
              .map(
                (game) =>
                  `**${game.name}** — Universe \`${game.universeId}\`\n` +
                  `Secret: \`${game.secretHint}…\` · ${game.active ? '🟢 aktiv' : '⚪ inaktiv'} · ` +
                  `letztes Event: ${game.lastEventAt ? discordTimestamp(game.lastEventAt, 'R') : '—'}`,
              )
              .join('\n\n') || 'Noch kein Spiel verbunden.',
          ),
        ],
        ephemeral: true,
      });
      return;
    }

    // Die Verknuepfung erfolgt bewusst im Dashboard: dort kann das Secret
    // einmalig sicher angezeigt werden. Im Chat waere es dauerhaft sichtbar.
    await interaction.reply({
      embeds: [
        embeds.info(
          'Spiele werden im Dashboard verbunden: **Einstellungen → Roblox → Spiel hinzufuegen**.\n' +
            'Dort wird das Signing-Secret genau einmal angezeigt und danach nur noch als Hash gespeichert.\n\n' +
            'Grund: Ein Secret im Chatverlauf waere dauerhaft einsehbar (Regel 54).',
        ),
      ],
      ephemeral: true,
    });
  },
};

const robloxModule: NexusModule = {
  name: 'roblox',
  description: 'Roblox-Verifizierung, Server-Monitor und Fernsteuerung',
  commands: [verify, unlink, roblox, robloxAdmin],
  jobs: [
    {
      name: 'roblox:stale-servers',
      intervalMs: 60_000,
      singleton: true,
      execute: async (services) => {
        // Instanzen ohne Heartbeat gelten nach 3 Minuten als offline.
        const stale = await services.store.roblox.markStaleServers(new Date(Date.now() - 3 * MINUTE));
        if (stale > 0) services.log.debug('Server als offline markiert', { count: stale });
        await services.store.roblox.expireCommands(new Date());
        await services.store.verification.purgeExpired(new Date());
      },
    },
    {
      name: 'roblox:group-sync',
      intervalMs: 30 * MINUTE,
      singleton: true,
      execute: async (services) => {
        const service = new VerificationService(services);
        for (const guild of services.client.guilds.cache.values()) {
          const config = await services.guildContext.config(guild.id);
          if (!config.robloxEnabled) continue;
          const groups = await services.store.roblox.listGroups(guild.id);
          if (groups.length === 0) continue;

          const members = await guild.members.fetch().catch(() => null);
          if (!members) continue;
          for (const member of members.values()) {
            const account = await services.store.roblox.getAccountByDiscordId(member.id);
            if (!account) continue;
            await service.syncGroupRoles(guild, member, account).catch(() => undefined);
          }
        }
      },
    },
  ],
};

export default robloxModule;
export { VerificationService } from './verification.js';
