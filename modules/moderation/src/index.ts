import { ApplicationCommandType, ContextMenuCommandBuilder } from 'discord.js';
import { embeds, truncate, type NexusModule } from '@nexus/bot-core';
import { discordTimestamp } from '@nexus/shared';
import { moderationCommands } from './commands.js';
import { ModerationService } from './service.js';

/**
 * Modul: Moderation (Regel 5).
 * Enthaelt Befehle, Kontextmenues und den Scheduler fuer befristete Massnahmen.
 */
const moderationModule: NexusModule = {
  name: 'moderation',
  description: 'Moderationsbefehle mit vollstaendiger Fallhistorie',
  commands: moderationCommands,
  contextMenus: [
    {
      category: 'moderation',
      permission: 'discord.moderation.view',
      data: new ContextMenuCommandBuilder()
        .setName('NEXUS: Historie')
        .setType(ApplicationCommandType.User),
      execute: async ({ interaction, services, t }) => {
        if (!interaction.isUserContextMenuCommand() || !interaction.guildId) return;
        const result = await services.store.moderation.listCases(interaction.guildId, {
          targetId: interaction.targetUser.id,
          pageSize: 8,
        });
        const description =
          result.items.length === 0
            ? t('moderation.noCases')
            : result.items
                .map(
                  (entry) =>
                    `\`${entry.caseId}\` ${ModerationService.label(entry.action)} — ${discordTimestamp(entry.createdAt, 'R')}\n${truncate(entry.reason, 100)}`,
                )
                .join('\n\n');
        await interaction.reply({
          embeds: [embeds.primary(`📚 ${interaction.targetUser.tag}`, description).setFooter({ text: `${result.total} Faelle` })],
          ephemeral: true,
        });
      },
    },
  ],
  jobs: [
    {
      name: 'moderation:expirations',
      intervalMs: 60_000,
      singleton: true,
      runOnStart: true,
      execute: async (services) => {
        const processed = await ModerationService.processExpirations(services);
        if (processed > 0) services.log.info('Befristete Massnahmen aufgehoben', { count: processed });
      },
    },
  ],
};

export default moderationModule;
export { ModerationService } from './service.js';
