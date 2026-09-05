import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, DiscordAPIError, MessageFlags,
  type AnySelectMenuInteraction, type AutocompleteInteraction, type BaseInteraction,
  type ButtonInteraction, type ChatInputCommandInteraction, type ContextMenuCommandInteraction,
  type Interaction, type InteractionReplyOptions, type MessageContextMenuCommandInteraction,
  type ModalSubmitInteraction,
  type RepliableInteraction,
} from 'discord.js';
import { assertFeature } from '@nexus/config';
import type { PermissionNode } from '@nexus/permissions';
import {
  ForbiddenError, RateLimitError, formatDuration, isNexusError, sortableId, toNexusError,
} from '@nexus/shared';
import { createTranslator, normalizeLocale, type Translator } from '../i18n/index.js';
import { embeds } from './embeds.js';
import type { Services } from './container.js';
import type { ModuleRegistry } from './registry.js';
import type { BaseContext, ModuleToggle } from './types.js';
import { parseCustomId } from './types.js';

/** Globales Interaktions-Limit je Nutzer — schuetzt vor Missbrauch (Regel 3). */
const GLOBAL_RATE_LIMIT = { limit: 20, windowMs: 10_000 };

export class InteractionRouter {
  constructor(
    private readonly services: Services,
    private readonly registry: ModuleRegistry,
  ) {}

  /** Einstiegspunkt fuer `interactionCreate`. */
  async handle(interaction: Interaction): Promise<void> {
    try {
      if (interaction.isChatInputCommand()) return await this.handleCommand(interaction);
      if (interaction.isAutocomplete()) return await this.handleAutocomplete(interaction);
      if (interaction.isContextMenuCommand()) return await this.handleContextMenu(interaction);
      if (interaction.isButton()) return await this.handleComponent(interaction, 'button');
      if (interaction.isAnySelectMenu()) return await this.handleComponent(interaction, 'select');
      if (interaction.isModalSubmit()) return await this.handleComponent(interaction, 'modal');
    } catch (error) {
      await this.reportError(interaction, error);
    }
  }

  // ------------------------------------------------------------- Kontext
  private async buildContext(interaction: BaseInteraction): Promise<BaseContext> {
    const guildId = interaction.guildId;
    const userLocale = normalizeLocale(interaction.locale);
    const locale = guildId
      ? await this.services.guildContext.locale(guildId, userLocale)
      : userLocale;
    const t = createTranslator(locale);
    const config = guildId ? await this.services.guildContext.config(guildId) : null;

    const requirePermission = async (node: PermissionNode): Promise<void> => {
      const member = interaction.inCachedGuild() ? interaction.member : null;
      await this.services.guildContext.assert(
        {
          userId: interaction.user.id,
          guildId: guildId ?? undefined,
          roleIds: member ? [...member.roles.cache.keys()] : [],
          isGuildOwner: member ? member.id === interaction.guild?.ownerId : false,
          hasDiscordAdmin: member?.permissions.has('Administrator') ?? false,
        },
        node,
      );
    };

    return {
      services: this.services,
      locale,
      t,
      config,
      log: this.services.log.child({
        guildId: guildId ?? undefined,
        userId: interaction.user.id,
      }),
      requirePermission,
    };
  }

  // ------------------------------------------------------------ Befehle
  private async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const command = this.registry.commands.get(interaction.commandName);
    if (!command) {
      this.services.log.warn('Unbekannter Befehl', { command: interaction.commandName });
      return;
    }

    const ctx = await this.buildContext(interaction);

    if (command.guildOnly !== false && !interaction.guildId) {
      await this.respond(interaction, { embeds: [embeds.error(ctx.t('common.guildOnly'))], flags: MessageFlags.Ephemeral });
      return;
    }

    if (command.ownerOnly && !this.services.env.DISCORD_OWNER_IDS.split(',').includes(interaction.user.id)) {
      await this.respond(interaction, { embeds: [embeds.error(ctx.t('common.noPermission', { node: 'owner' }))], flags: MessageFlags.Ephemeral });
      return;
    }

    if (!(await this.guardModule(interaction, ctx, command.moduleToggle))) return;
    if (!(await this.guardBlacklist(interaction, ctx))) return;
    await this.guardRateLimit(interaction.user.id);

    if (command.feature && interaction.guildId) {
      assertFeature(await this.services.guildContext.tier(interaction.guildId), command.feature);
    }

    if (command.permission) await ctx.requirePermission(command.permission);

    if (command.cooldownMs) {
      await this.services.cache.consumeCooldown(`cmd:${command.data.name}`, interaction.user.id, command.cooldownMs);
    }

    const startedAt = Date.now();
    await command.execute({ ...ctx, interaction });
    ctx.log.debug('Befehl ausgefuehrt', {
      command: interaction.commandName,
      durationMs: Date.now() - startedAt,
    });
  }

  private async handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const command = this.registry.commands.get(interaction.commandName);
    if (!command?.autocomplete) return await interaction.respond([]);
    const ctx = await this.buildContext(interaction);
    try {
      await command.autocomplete({ ...ctx, interaction });
    } catch (error) {
      ctx.log.warn('Autocomplete fehlgeschlagen', { error: String(error) });
      if (!interaction.responded) await interaction.respond([]);
    }
  }

  private async handleContextMenu(interaction: ContextMenuCommandInteraction): Promise<void> {
    const menu = this.registry.contextMenus.get(interaction.commandName);
    if (!menu) return;
    // Die Union-Variante traegt die konkreten Ziel-Eigenschaften (targetUser/targetMessage).
    const typed = interaction.isUserContextMenuCommand()
      ? interaction
      : (interaction as MessageContextMenuCommandInteraction);
    const ctx = await this.buildContext(interaction);
    if (!(await this.guardBlacklist(typed, ctx))) return;
    await this.guardRateLimit(interaction.user.id);
    if (menu.permission) await ctx.requirePermission(menu.permission);
    if (menu.cooldownMs) {
      await this.services.cache.consumeCooldown(`ctx:${menu.data.name}`, interaction.user.id, menu.cooldownMs);
    }
    await menu.execute({ ...ctx, interaction: typed });
  }

  // --------------------------------------------------------- Komponenten
  private async handleComponent(
    interaction: ButtonInteraction | AnySelectMenuInteraction | ModalSubmitInteraction,
    kind: 'button' | 'select' | 'modal',
  ): Promise<void> {
    const parsed = parseCustomId(interaction.customId);
    if (!parsed) return; // Fremde Komponenten ignorieren.

    const handler = this.registry.component(kind, parsed.namespace);
    if (!handler) {
      this.services.log.warn('Kein Handler fuer Komponente', { customId: interaction.customId, kind });
      return;
    }

    const ctx = await this.buildContext(interaction);
    if (!(await this.guardBlacklist(interaction, ctx))) return;
    await this.guardRateLimit(interaction.user.id);
    if (handler.permission) await ctx.requirePermission(handler.permission);
    if (handler.cooldownMs) {
      await this.services.cache.consumeCooldown(`cmp:${parsed.namespace}`, interaction.user.id, handler.cooldownMs);
    }

    await handler.execute({ ...ctx, interaction, args: [parsed.action, ...parsed.args] });
  }

  // ---------------------------------------------------------------- Guards
  private async guardRateLimit(userId: string): Promise<void> {
    await this.services.cache.enforceRateLimit(
      'interaction', userId, GLOBAL_RATE_LIMIT.limit, GLOBAL_RATE_LIMIT.windowMs,
    );
  }

  private async guardBlacklist(interaction: RepliableInteraction, ctx: BaseContext): Promise<boolean> {
    const user = await this.services.store.users.findByDiscordId(interaction.user.id);
    if (!user?.blacklisted) return true;
    await this.respond(interaction, {
      embeds: [embeds.error('Dein Konto ist global fuer NEXUS gesperrt.')],
      flags: MessageFlags.Ephemeral,
    });
    ctx.log.security('Interaktion eines gesperrten Kontos abgelehnt', { userId: interaction.user.id });
    return false;
  }

  private async guardModule(
    interaction: RepliableInteraction, ctx: BaseContext, toggle?: ModuleToggle,
  ): Promise<boolean> {
    if (!toggle || !ctx.config || ctx.config[toggle]) return true;
    await this.respond(interaction, {
      embeds: [embeds.warning(ctx.t('common.moduleDisabled', { module: toggle.replace('Enabled', '') }))],
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  // -------------------------------------------------------- Fehlerausgabe
  private async respond(interaction: RepliableInteraction, options: InteractionReplyOptions): Promise<void> {
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(options);
      } else {
        await interaction.reply(options);
      }
    } catch (error) {
      // Unknown Interaction (10062) tritt bei Timeouts auf und ist nicht kritisch.
      if (error instanceof DiscordAPIError && error.code === 10062) return;
      this.services.log.warn('Antwort konnte nicht gesendet werden', { error: String(error) });
    }
  }

  /**
   * Zentrale Fehlerbehandlung (Regel 40).
   * Erwartete Fehler werden dem Nutzer erklaert, unerwartete erhalten eine
   * Referenz-ID, damit Logs und Nutzermeldung zusammengefuehrt werden koennen.
   */
  private async reportError(interaction: Interaction, error: unknown): Promise<void> {
    const nexusError = toNexusError(error);
    const locale = normalizeLocale(interaction.locale);
    const t: Translator = createTranslator(locale);

    if (!interaction.isRepliable()) {
      this.services.log.error('Fehler in nicht beantwortbarer Interaktion', nexusError);
      return;
    }

    if (nexusError instanceof RateLimitError) {
      await this.respond(interaction, {
        embeds: [embeds.warning(t('common.rateLimited', { duration: formatDuration(nexusError.retryAfterMs) }))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (nexusError instanceof ForbiddenError) {
      this.services.log.security('Berechtigung verweigert', {
        userId: interaction.user.id,
        guildId: interaction.guildId ?? undefined,
        node: String(nexusError.meta['node'] ?? 'unbekannt'),
      });
      await this.respond(interaction, {
        embeds: [embeds.error(t('common.noPermission', { node: String(nexusError.meta['node'] ?? '?') }))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (isNexusError(error) && error.expected) {
      await this.respond(interaction, {
        embeds: [embeds.warning(error.message)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const reference = sortableId('err');
    this.services.log.error('Unerwarteter Fehler in Interaktion', nexusError, {
      reference,
      userId: interaction.user.id,
      guildId: interaction.guildId ?? undefined,
    });
    await this.respond(interaction, {
      embeds: [embeds.error(t('common.errorWithId', { id: reference }))],
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Bestaetigungsdialog fuer gefaehrliche Aktionen (Regel 22/32).
 * Nur der ausloesende Nutzer darf bestaetigen; nach Ablauf gilt "abgebrochen".
 */
export async function requireConfirmation(
  interaction: RepliableInteraction,
  options: { title: string; description: string; confirmLabel: string; cancelLabel: string; timeoutMs?: number },
): Promise<boolean> {
  const token = sortableId('cf');
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`nexus:confirm:yes:${token}`).setLabel(options.confirmLabel).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`nexus:confirm:no:${token}`).setLabel(options.cancelLabel).setStyle(ButtonStyle.Secondary),
  );

  const payload = {
    embeds: [embeds.warning(options.description, options.title)],
    components: [row],
    flags: MessageFlags.Ephemeral as const,
  };
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(payload);
  } else {
    await interaction.reply(payload);
  }
  const message = await interaction.fetchReply();

  try {
    const response = await message.awaitMessageComponent({
      time: options.timeoutMs ?? 30_000,
      filter: (component) =>
        component.user.id === interaction.user.id && component.customId.endsWith(token),
    });
    const confirmed = response.customId.includes(':yes:');
    await response.update({
      embeds: [confirmed ? embeds.info('Wird ausgefuehrt…') : embeds.info('Abgebrochen.')],
      components: [],
    });
    return confirmed;
  } catch {
    await interaction.editReply({ embeds: [embeds.info('Zeitueberschreitung — abgebrochen.')], components: [] }).catch(() => undefined);
    return false;
  }
}
