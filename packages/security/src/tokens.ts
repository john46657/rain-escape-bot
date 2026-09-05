/**
 * API-Keys und Tokens.
 *
 * Es wird ausschliesslich der Hash gespeichert (Regel 49: ein Key darf nie
 * erneut vollstaendig angezeigt werden). Der Klartext existiert nur einmal
 * unmittelbar nach der Erstellung.
 */
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string, salt: string, keylen: number,
) => Promise<Buffer>;

export interface GeneratedApiKey {
  /** Nur einmalig sichtbar. */
  plaintext: string;
  /** Persistierbarer SHA-256-Hash (Lookup muss schnell sein). */
  hash: string;
  /** Anzeigbarer Praefix, z. B. "nxs_live_a1b2c3". */
  prefix: string;
  /** Letzte vier Zeichen fuer die Wiedererkennung. */
  last4: string;
}

export function generateApiKey(environment: 'live' | 'test' = 'live'): GeneratedApiKey {
  const secret = randomBytes(32).toString('base64url');
  const plaintext = `nxs_${environment}_${secret}`;
  return {
    plaintext,
    hash: hashApiKey(plaintext),
    prefix: plaintext.slice(0, 14),
    last4: plaintext.slice(-4),
  };
}

/** SHA-256 genuegt: API-Keys haben volle 256 Bit Entropie (kein Brute-Force). */
export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export function verifyApiKey(plaintext: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashApiKey(plaintext), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

/** Fuer Werte mit geringer Entropie (z. B. Verifizierungscodes). */
export async function hashSecret(value: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(value, salt, 32);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

export async function verifySecret(value: string, stored: string): Promise<boolean> {
  const [algorithm, salt, hash] = stored.split('$');
  if (algorithm !== 'scrypt' || !salt || !hash) return false;
  const derived = await scrypt(value, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
