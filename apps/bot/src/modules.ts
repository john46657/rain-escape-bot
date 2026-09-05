/**
 * Zentrale Modul-Registrierung.
 *
 * Statische Importe statt dynamischem Verzeichnis-Scan: dadurch ist die
 * Modulliste typgeprueft, bundlebar (esbuild) und ohne Laufzeit-Magie.
 */
import type { NexusModule } from './core/types.js';
import aiModule from '@nexus/module-ai';
import analyticsModule from '@nexus/module-analytics';
import automationModule from '@nexus/module-automation';
import backupModule from '@nexus/module-backup';
import communityModule from '@nexus/module-community';
import economyModule from '@nexus/module-economy';
import gamesModule from '@nexus/module-games';
import giveawaysModule from '@nexus/module-giveaways';
import levelsModule from '@nexus/module-levels';
import moderationModule from '@nexus/module-moderation';
import musicModule from '@nexus/module-music';
import robloxModule from '@nexus/module-roblox';
import securityModule from '@nexus/module-security';
import ticketsModule from '@nexus/module-tickets';
import { generalModule } from './general.js';

export function loadModules(): NexusModule[] {
  return [
    generalModule,
    moderationModule,
    securityModule,
    ticketsModule,
    communityModule,
    levelsModule,
    economyModule,
    gamesModule,
    giveawaysModule,
    musicModule,
    robloxModule,
    automationModule,
    analyticsModule,
    backupModule,
    aiModule,
  ];
}
