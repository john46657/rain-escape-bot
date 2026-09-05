/**
 * Entfernt Secrets aus Objekten, bevor sie geloggt oder ueber die API
 * ausgeliefert werden. Regel 34/52: niemals Secrets speichern oder loggen.
 */
const SENSITIVE_KEYS = [
  'token',
  'password',
  'secret',
  'apikey',
  'api_key',
  'authorization',
  'cookie',
  'session',
  'signature',
  'privatekey',
  'private_key',
  'clientsecret',
  'client_secret',
  'refresh_token',
  'access_token',
  'discord_token',
  'roblox_api_key',
  'hash',
  'salt',
];

const MASK = '[redacted]';

function isSensitive(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_\s]/g, '');
  return SENSITIVE_KEYS.some((candidate) => normalized.includes(candidate.replace(/[-_]/g, '')));
}

export function redact<T>(value: T, depth = 6): T {
  if (depth <= 0 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth - 1)) as unknown as T;
  if (value instanceof Date) return value;

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = isSensitive(key) ? MASK : redact(entry, depth - 1);
  }
  return output as T;
}

/** Zeigt nur die letzten Zeichen eines Secrets an (z. B. API-Key-Vorschau). */
export function maskTail(value: string, visible = 4): string {
  if (value.length <= visible) return '*'.repeat(value.length);
  return `${'*'.repeat(Math.min(12, value.length - visible))}${value.slice(-visible)}`;
}
