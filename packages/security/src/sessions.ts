/**
 * Signierte, zustandslose Session-Cookies fuer das Dashboard.
 * Enthalten bewusst keine Discord-Tokens — nur die Session-Referenz.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SessionPayload {
  userId: string;
  discordId: string;
  issuedAt: number;
  expiresAt: number;
}

export function signSession(secret: string, payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifySession(secret: string, token: string): SessionPayload | null {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    return payload.expiresAt > Date.now() ? payload : null;
  } catch {
    return null;
  }
}
