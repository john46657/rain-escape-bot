import { randomBytes, randomInt as nodeRandomInt, randomUUID } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789'; // ohne I, L, O, U (Verwechslungsgefahr)

export const uuid = (): string => randomUUID();

/** Kryptografisch sicherer, gut vorlesbarer Code (z. B. Verifizierungscodes). */
export function humanCode(length = 8, groupSize = 4): string {
  const chars: string[] = [];
  for (let i = 0; i < length; i++) chars.push(BASE32_ALPHABET[nodeRandomInt(BASE32_ALPHABET.length)]!);
  if (groupSize <= 0) return chars.join('');
  const groups: string[] = [];
  for (let i = 0; i < chars.length; i += groupSize) groups.push(chars.slice(i, i + groupSize).join(''));
  return groups.join('-');
}

/** Praefixierter, URL-sicherer Token (z. B. "nxs_live_...."). */
export function prefixedToken(prefix: string, bytes = 32): string {
  return `${prefix}_${randomBytes(bytes).toString('base64url')}`;
}

/** Nonce fuer Replay-Schutz. */
export const nonce = (): string => randomBytes(16).toString('base64url');

/** Sortierbare ID (Zeitanteil + Zufall), praktisch fuer Logs/Events. */
export function sortableId(prefix?: string): string {
  const time = Date.now().toString(36).padStart(9, '0');
  const rand = randomBytes(8).toString('hex');
  return prefix ? `${prefix}_${time}${rand}` : `${time}${rand}`;
}

/** Case-ID im Format NX-<GUILD_SUFFIX>-<SEQ>, z. B. NX-4821-000137. */
export function formatCaseId(guildId: string, sequence: number): string {
  return `NX-${guildId.slice(-4)}-${sequence.toString().padStart(6, '0')}`;
}

/**
 * Ganzzahl im Bereich [min, max] auf Basis eines kryptografisch sicheren
 * Zufallsgenerators. Fuer Spiele und Belohnungen relevant, damit Ergebnisse
 * nicht vorhersagbar sind.
 */
export function randomInt(min: number, max: number): number {
  if (max < min) throw new RangeError('max muss groesser oder gleich min sein');
  // node:crypto liefert bereits eine verzerrungsfreie Ganzzahl.
  return nodeRandomInt(min, max + 1);
}

/** Kurzer, gut vorlesbarer Code ohne Trennzeichen (Verifizierung). */
export function randomCode(length = 6): string {
  return humanCode(length, 0);
}
