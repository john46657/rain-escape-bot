import { SlashCommandBuilder } from 'discord.js';
import { embeds, type NexusModule, type SlashCommand } from '@nexus/bot-core';

/**
 * Modul: Musik (Regel 17) — SCAFFOLD.
 *
 * Ehrliche Einordnung (Regel 52: keine erfundenen Funktionen):
 * Discord-Bots koennen Audio nur ueber einen Voice-Gateway-Stream abspielen.
 * Fuer eine produktionsreife Musikwiedergabe wird ein externer Audio-Knoten
 * benoetigt (z. B. Lavalink). Ohne konfigurierten Knoten meldet dieses Modul
 * das offen, statt eine Funktion vorzutaeuschen.
 *
 * Voraussetzungen fuer die Aktivierung (siehe docs/MODULES.md):
 *   1. Lavalink-Server betreiben (Docker-Compose-Beispiel liegt bei)
 *   2. LAVALINK_HOST / LAVALINK_PORT / LAVALINK_PASSWORD setzen
 *   3. Client-Bibliothek einbinden und `MusicPlayer` implementieren
 *   4. Rechtliche Pruefung der genutzten Quellen
 */

function notConfigured(feature: string): ReturnType<typeof embeds.warning> {
  return embeds.warning(
    `**${feature}** benoetigt einen Audio-Knoten (Lavalink), der fuer diese Installation nicht konfiguriert ist.\n\n` +
      'Setze `LAVALINK_HOST`, `LAVALINK_PORT` und `LAVALINK_PASSWORD` in der `.env` und starte den Bot neu.\n' +
      'Details: `docs/MODULES.md#musik`.',
    'Musikmodul nicht konfiguriert',
  );
}

const music: SlashCommand = {
  category: 'music',
  moduleToggle: 'musicEnabled',
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Musikwiedergabe (erfordert Lavalink)')
    .addSubcommand((sub) =>
      sub
        .setName('play')
        .setDescription('Spielt einen Titel ab')
        .addStringOption((option) =>
          option.setName('query').setDescription('Suchbegriff oder URL').setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('skip').setDescription('Ueberspringt den aktuellen Titel'))
    .addSubcommand((sub) => sub.setName('stop').setDescription('Beendet die Wiedergabe'))
    .addSubcommand((sub) => sub.setName('queue').setDescription('Zeigt die Warteschlange'))
    .addSubcommand((sub) => sub.setName('status').setDescription('Zeigt den Status des Audio-Knotens')),
  execute: async ({ interaction, services }) => {
    const host = services.env.LAVALINK_HOST;
    if (!host) {
      await interaction.reply({
        embeds: [notConfigured(`/music ${interaction.options.getSubcommand()}`)],
        ephemeral: true,
      });
      return;
    }
    await interaction.reply({
      embeds: [
        embeds.info(
          `Audio-Knoten konfiguriert: \`${host}:${services.env.LAVALINK_PORT ?? 2333}\`.\n` +
            'Die Player-Implementierung ist als Erweiterungspunkt vorgesehen (`MusicPlayer`).',
        ),
      ],
      ephemeral: true,
    });
  },
};

const musicModule: NexusModule = {
  name: 'music',
  description: 'Musikwiedergabe (Scaffold — erfordert externen Audio-Knoten)',
  commands: [music],
};

export default musicModule;
