import { EmbedBuilder } from 'discord.js';
import { BRAND } from '@nexus/shared';

const FOOTER = { text: 'NEXUS • Discord × Roblox' };

const base = (color: number): EmbedBuilder =>
  new EmbedBuilder().setColor(color).setFooter(FOOTER).setTimestamp(new Date());

export const embeds = {
  primary: (title?: string, description?: string): EmbedBuilder => {
    const embed = base(BRAND.colors.primary);
    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);
    return embed;
  },
  success: (description: string, title?: string): EmbedBuilder =>
    base(BRAND.colors.success)
      .setDescription(`✅ ${description}`)
      .setTitle(title ?? null),
  warning: (description: string, title?: string): EmbedBuilder =>
    base(BRAND.colors.warning)
      .setDescription(`⚠️ ${description}`)
      .setTitle(title ?? null),
  error: (description: string, title?: string): EmbedBuilder =>
    base(BRAND.colors.danger)
      .setDescription(`⛔ ${description}`)
      .setTitle(title ?? null),
  info: (description: string, title?: string): EmbedBuilder =>
    base(BRAND.colors.info)
      .setDescription(description)
      .setTitle(title ?? null),
  security: (title: string, description: string): EmbedBuilder =>
    base(BRAND.colors.security).setTitle(`🛡️ ${title}`).setDescription(description),
};

/** Fortschrittsbalken fuer Level-/Statusanzeigen. */
export function progressBar(current: number, total: number, size = 14): string {
  const ratio = total <= 0 ? 0 : Math.min(1, Math.max(0, current / total));
  const filled = Math.round(ratio * size);
  return `${'█'.repeat(filled)}${'░'.repeat(size - filled)} ${Math.round(ratio * 100)}%`;
}

/** Kuerzt Text auf die Discord-Limits, ohne mitten im Wort zu schneiden. */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}
