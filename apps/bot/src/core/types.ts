import type {
  AutocompleteInteraction, ButtonInteraction, ChatInputCommandInteraction, ClientEvents,
  ContextMenuCommandBuilder, MessageContextMenuCommandInteraction, ModalSubmitInteraction,
  AnySelectMenuInteraction, SlashCommandBuilder, SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder, UserContextMenuCommandInteraction,
} from 'discord.js';
import type { PermissionNode } from '@nexus/permissions';
import type { FeatureKey } from '@nexus/config';
import type { GuildConfigEntity } from '@nexus/database';
import type { Locale } from '@nexus/shared';
import type { Logger } from '@nexus/logger';
import type { Translator } from '../i18n/index.js';
import type { Services } from './container.js';

/** Module, deren Aktivierung pro Guild konfigurierbar ist. */
export type ModuleToggle = keyof Pick<
  GuildConfigEntity,
  | 'moderationEnabled' | 'automodEnabled' | 'antiNukeEnabled' | 'ticketsEnabled'
  | 'levelsEnabled' | 'economyEnabled' | 'gamesEnabled' | 'giveawaysEnabled'
  | 'musicEnabled' | 'aiEnabled' | 'robloxEnabled'
>;

export const COMMAND_CATEGORIES = [
  'general', 'moderation', 'security', 'tickets', 'community', 'levels',
  'economy', 'games', 'giveaways', 'music', 'roblox', 'automation', 'analytics',
  'backup', 'ai', 'admin',
] as const;
export type CommandCategory = (typeof COMMAND_CATEGORIES)[number];

/** Gemeinsamer Kontext aller Interaktions-Handler. */
export interface BaseContext {
  services: Services;
  locale: Locale;
  t: Translator;
  log: Logger;
  /** Guild-Konfiguration; null bei DM-Interaktionen. */
  config: GuildConfigEntity | null;
  /**
   * Prueft eine NEXUS-Berechtigung und wirft bei fehlender Berechtigung.
   * Muss vor jeder sicherheitsrelevanten Aktion aufgerufen werden (Regel 52).
   */
  requirePermission: (node: PermissionNode) => Promise<void>;
}

export interface CommandContext extends BaseContext {
  interaction: ChatInputCommandInteraction;
}

export interface AutocompleteContext extends BaseContext {
  interaction: AutocompleteInteraction;
}

export interface ComponentContext<T = ButtonInteraction | AnySelectMenuInteraction | ModalSubmitInteraction>
  extends BaseContext {
  interaction: T;
  /** Aus der customId extrahierte Argumente (nexus:ns:action:arg1:arg2). */
  args: string[];
}

export interface ContextMenuContext extends BaseContext {
  interaction: UserContextMenuCommandInteraction | MessageContextMenuCommandInteraction;
}

export type SlashCommandData =
  | SlashCommandBuilder
  | SlashCommandOptionsOnlyBuilder
  | SlashCommandSubcommandsOnlyBuilder
  | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;

export interface SlashCommand {
  data: SlashCommandData;
  category: CommandCategory;
  /** Erforderliche NEXUS-Berechtigung; wird vor `execute` geprueft. */
  permission?: PermissionNode;
  /** Erforderliches Premium-Feature (Regel 46). */
  feature?: FeatureKey;
  /** Guild-Konfigurationsschalter, der aktiv sein muss. */
  moduleToggle?: ModuleToggle;
  cooldownMs?: number;
  guildOnly?: boolean;
  /** Nur Bot-Owner (Wartungsbefehle). */
  ownerOnly?: boolean;
  execute: (ctx: CommandContext) => Promise<void>;
  autocomplete?: (ctx: AutocompleteContext) => Promise<void>;
}

export interface ContextMenuCommand {
  data: ContextMenuCommandBuilder;
  category: CommandCategory;
  permission?: PermissionNode;
  cooldownMs?: number;
  execute: (ctx: ContextMenuContext) => Promise<void>;
}

/**
 * Handler fuer Buttons, Select-Menues und Modals.
 * `id` ist der Namespace-Teil der customId: `nexus:<id>:<action>:<args...>`.
 */
export interface ComponentHandler {
  id: string;
  kind: 'button' | 'select' | 'modal';
  permission?: PermissionNode;
  cooldownMs?: number;
  execute: (ctx: ComponentContext) => Promise<void>;
}

export interface EventHandler<K extends keyof ClientEvents = keyof ClientEvents> {
  event: K;
  once?: boolean;
  execute: (services: Services, ...args: ClientEvents[K]) => Promise<void>;
}

/**
 * Union aller konkreten Event-Handler.
 * Noetig, weil `EventHandler<keyof ClientEvents>` wegen Parameter-Varianz
 * keinen konkreten Handler (z. B. `EventHandler<Events.GuildCreate>`) akzeptiert.
 */
export type AnyEventHandler = { [K in keyof ClientEvents]: EventHandler<K> }[keyof ClientEvents];

/** Wiederkehrende Hintergrundaufgabe (Timeouts pruefen, Heartbeats, Sync). */
export interface ScheduledJob {
  name: string;
  intervalMs: number;
  /** Nur eine Instanz im Cluster fuehrt den Job aus (verteilter Lock). */
  singleton?: boolean;
  runOnStart?: boolean;
  execute: (services: Services) => Promise<void>;
}

/** Ein NEXUS-Modul buendelt alles, was zu einem Fachbereich gehoert. */
export interface NexusModule {
  name: string;
  description: string;
  commands?: SlashCommand[];
  contextMenus?: ContextMenuCommand[];
  components?: ComponentHandler[];
  events?: AnyEventHandler[];
  jobs?: ScheduledJob[];
  /** Wird nach dem Login einmalig aufgerufen. */
  setup?: (services: Services) => Promise<void>;
}

/** Baut eine customId nach NEXUS-Konvention. */
export function customId(namespace: string, action: string, ...args: Array<string | number>): string {
  const id = ['nexus', namespace, action, ...args.map(String)].join(':');
  if (id.length > 100) throw new Error(`customId zu lang (${id.length} > 100): ${id}`);
  return id;
}

export function parseCustomId(raw: string): { namespace: string; action: string; args: string[] } | null {
  const parts = raw.split(':');
  if (parts.length < 3 || parts[0] !== 'nexus') return null;
  return { namespace: parts[1]!, action: parts[2]!, args: parts.slice(3) };
}
