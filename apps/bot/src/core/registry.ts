import { Collection } from 'discord.js';
import type { Logger } from '@nexus/logger';
import type {
  AnyEventHandler,
  ComponentHandler,
  ContextMenuCommand,
  NexusModule,
  ScheduledJob,
  SlashCommand,
} from './types.js';

/**
 * Registry aller Module.
 * Kollisionen (doppelte Befehlsnamen/Handler-IDs) werden beim Laden erkannt —
 * lieber ein Startfehler als undefiniertes Verhalten zur Laufzeit.
 */
export class ModuleRegistry {
  readonly commands = new Collection<string, SlashCommand>();
  readonly contextMenus = new Collection<string, ContextMenuCommand>();
  readonly components = new Collection<string, ComponentHandler>();
  readonly events: AnyEventHandler[] = [];
  readonly jobs: ScheduledJob[] = [];
  readonly modules: NexusModule[] = [];

  constructor(private readonly log: Logger) {}

  register(module: NexusModule): void {
    this.modules.push(module);

    for (const command of module.commands ?? []) {
      const name = command.data.name;
      if (this.commands.has(name)) throw new Error(`Doppelter Befehl "${name}" (Modul ${module.name})`);
      this.commands.set(name, command);
    }

    for (const menu of module.contextMenus ?? []) {
      if (this.contextMenus.has(menu.data.name)) {
        throw new Error(`Doppeltes Kontextmenue "${menu.data.name}" (Modul ${module.name})`);
      }
      this.contextMenus.set(menu.data.name, menu);
    }

    for (const component of module.components ?? []) {
      const key = `${component.kind}:${component.id}`;
      if (this.components.has(key)) throw new Error(`Doppelter Component-Handler "${key}"`);
      this.components.set(key, component);
    }

    this.events.push(...(module.events ?? []));
    this.jobs.push(...(module.jobs ?? []));

    this.log.debug('Modul registriert', {
      module: module.name,
      commands: module.commands?.length ?? 0,
      events: module.events?.length ?? 0,
      jobs: module.jobs?.length ?? 0,
    });
  }

  registerAll(modules: NexusModule[]): void {
    for (const module of modules) this.register(module);
  }

  component(kind: ComponentHandler['kind'], id: string): ComponentHandler | undefined {
    return this.components.get(`${kind}:${id}`);
  }

  /** JSON-Payload fuer die Discord-Befehlsregistrierung. */
  toApplicationCommands(): unknown[] {
    return [
      ...this.commands.map((command) => command.data.toJSON()),
      ...this.contextMenus.map((menu) => menu.data.toJSON()),
    ];
  }
}
