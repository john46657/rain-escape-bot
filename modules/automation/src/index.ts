import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { embeds, type NexusModule, type SlashCommand } from '@nexus/bot-core';
import { discordTimestamp } from '@nexus/shared';
import { AutomationEngine } from './engine.js';

/**
 * Modul: Automation (Regel 30).
 * Die Regeln werden im Dashboard erstellt; der Bot fuehrt sie aus.
 */
const automation: SlashCommand = {
  category: 'automation',
  permission: 'discord.automation.manage',
  data: new SlashCommandBuilder()
    .setName('automation')
    .setDescription('Automationsregeln')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) => sub.setName('list').setDescription('Zeigt alle Regeln'))
    .addSubcommand((sub) =>
      sub
        .setName('toggle')
        .setDescription('Aktiviert oder deaktiviert eine Regel')
        .addStringOption((option) => option.setName('id').setDescription('Regel-ID').setRequired(true)),
    ),
  execute: async ({ interaction, services }) => {
    const guildId = interaction.guildId!;
    if (interaction.options.getSubcommand() === 'list') {
      const rules = await services.store.automations.list(guildId);
      await interaction.reply({
        embeds: [
          embeds.primary(
            '⚙️ Automationen',
            rules
              .map(
                (rule) =>
                  `${rule.enabled ? '🟢' : '⚪'} **${rule.name}** \`${rule.id.slice(0, 8)}\`\n` +
                  `Trigger: \`${rule.trigger}\` · Laeufe: ${rule.runCount} (${rule.errorCount} Fehler)` +
                  (rule.lastRunAt ? ` · zuletzt ${discordTimestamp(rule.lastRunAt, 'R')}` : ''),
              )
              .join('\n\n') || 'Keine Regeln. Lege sie im Dashboard an.',
          ),
        ],
        ephemeral: true,
      });
      return;
    }

    const id = interaction.options.getString('id', true);
    const rule = (await services.store.automations.list(guildId)).find((entry) => entry.id.startsWith(id));
    if (!rule) {
      await interaction.reply({ embeds: [embeds.warning('Regel nicht gefunden.')], ephemeral: true });
      return;
    }
    await services.store.automations.update(rule.id, { enabled: !rule.enabled });
    await interaction.reply({
      embeds: [embeds.success(`**${rule.name}** ist jetzt ${rule.enabled ? 'deaktiviert' : 'aktiv'}.`)],
      ephemeral: true,
    });
  },
};

const automationModule: NexusModule = {
  name: 'automation',
  description: 'Ereignisgesteuerte Automationsregeln',
  commands: [automation],
};

export default automationModule;
export { AutomationEngine, evaluateCondition } from './engine.js';
