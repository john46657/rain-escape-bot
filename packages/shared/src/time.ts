export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;

const DURATION_PATTERN = /(\d+)\s*(ms|s|m|h|d|w|y)/gi;
const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: SECOND,
  m: MINUTE,
  h: HOUR,
  d: DAY,
  w: WEEK,
  y: 365 * DAY,
};

/**
 * Parst Zeitangaben wie "10m", "2h30m", "7d" in Millisekunden.
 * Gibt null zurueck, wenn nichts Verwertbares gefunden wurde.
 */
export function parseDuration(input: string): number | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * SECOND;
  let total = 0;
  let matched = false;
  for (const match of trimmed.matchAll(DURATION_PATTERN)) {
    const amount = Number(match[1]);
    const unit = UNIT_MS[match[2]!.toLowerCase()];
    if (!Number.isFinite(amount) || unit === undefined) continue;
    total += amount * unit;
    matched = true;
  }
  return matched ? total : null;
}

/** Formatiert Millisekunden menschenlesbar (z. B. "2d 3h 10m"). */
export function formatDuration(ms: number, maxParts = 2): string {
  if (ms < SECOND) return `${Math.max(0, Math.round(ms))}ms`;
  const units: Array<[string, number]> = [
    ['d', DAY],
    ['h', HOUR],
    ['m', MINUTE],
    ['s', SECOND],
  ];
  const parts: string[] = [];
  let rest = Math.floor(ms);
  for (const [label, size] of units) {
    const value = Math.floor(rest / size);
    if (value > 0) {
      parts.push(`${value}${label}`);
      rest -= value * size;
    }
    if (parts.length >= maxParts) break;
  }
  return parts.join(' ') || '0s';
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Discord-Timestamp-Markup, z. B. <t:1700000000:R>. */
export function discordTimestamp(
  date: Date | number,
  style: 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R' = 'f',
): string {
  const seconds = Math.floor((date instanceof Date ? date.getTime() : date) / 1000);
  return `<t:${seconds}:${style}>`;
}

/** Beginn des Tages (UTC) — Grundlage fuer Tages-Buckets in der Analytik. */
export function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Beginn der Stunde (UTC). */
export function startOfHour(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCMinutes(0, 0, 0);
  return copy;
}
