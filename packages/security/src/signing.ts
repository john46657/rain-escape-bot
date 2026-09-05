/**
 * Request-Signatur fuer Roblox -> NEXUS (Regel 37).
 *
 * Schutzmechanismen:
 *  1. HMAC-SHA256 ueber eine kanonische Repraesentation des Requests
 *  2. Timestamp mit maximaler Abweichung (Clock Skew)
 *  3. Nonce mit Replay-Schutz (siehe replay.ts)
 *  4. Zeitkonstanter Vergleich
 *
 * Der Roblox-*Client* kennt das Secret nie — signiert wird ausschliesslich
 * im Server-Script ueber HttpService.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface SignaturePayload {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  body: string;
}

export interface SignatureVerification {
  valid: boolean;
  reason?: 'MALFORMED' | 'SKEW' | 'MISMATCH';
}

/**
 * Kanonische Zeichenkette. Aufbau und Reihenfolge sind Teil des Protokolls und
 * muessen exakt mit `packages/roblox-sdk/luau/NexusCrypto.luau` uebereinstimmen:
 *
 *   METHOD \n PATH \n TIMESTAMP \n NONCE \n BODY
 *
 * Der Body geht unveraendert ein (kein Vor-Hash), damit die Luau-Seite mit
 * einer einzigen Primitive (HMAC-SHA256) auskommt.
 */
export function canonicalString(payload: SignaturePayload): string {
  return [
    payload.method.toUpperCase(),
    payload.path,
    payload.timestamp,
    payload.nonce,
    payload.body,
  ].join('\n');
}

/** Allgemeiner SHA-256-Hex-Hash (z. B. fuer Idempotenzschluessel). */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function signRequest(secret: string, payload: SignaturePayload): string {
  return createHmac('sha256', secret).update(canonicalString(payload)).digest('hex');
}

/** Zeitkonstanter Vergleich — verhindert Timing-Angriffe. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export function verifySignature(
  secret: string,
  payload: SignaturePayload,
  signature: string,
  maxSkewSeconds = 300,
): SignatureVerification {
  if (!signature || !payload.timestamp || !payload.nonce) return { valid: false, reason: 'MALFORMED' };

  const timestamp = Number(payload.timestamp);
  if (!Number.isFinite(timestamp)) return { valid: false, reason: 'MALFORMED' };

  const skew = Math.abs(Date.now() / 1000 - timestamp);
  if (skew > maxSkewSeconds) return { valid: false, reason: 'SKEW' };

  const expected = signRequest(secret, payload);
  return safeEqual(expected, signature) ? { valid: true } : { valid: false, reason: 'MISMATCH' };
}
