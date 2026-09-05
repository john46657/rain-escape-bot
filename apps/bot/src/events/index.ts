import type { AnyEventHandler } from '../core/types.js';
import { guildCreate, guildDelete } from './guild.js';
import { ready } from './ready.js';
import { errorEvents } from './errors.js';

/** Kern-Events. Fachliche Events liefern die Module selbst mit. */
export const coreEvents: AnyEventHandler[] = [ready, guildCreate, guildDelete, ...errorEvents];
