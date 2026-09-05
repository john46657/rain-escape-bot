export function formatNumber(value: number): string {
  return value.toLocaleString('de-DE');
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const diff = Date.now() - new Date(value).getTime();
  const units: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [60_000, 'second'],
    [3_600_000, 'minute'],
    [86_400_000, 'hour'],
    [Number.POSITIVE_INFINITY, 'day'],
  ];
  const divisors = [1_000, 60_000, 3_600_000, 86_400_000];
  const formatter = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' });
  for (let index = 0; index < units.length; index++) {
    if (Math.abs(diff) < units[index]![0]) {
      return formatter.format(-Math.round(diff / divisors[index]!), units[index]![1]);
    }
  }
  return formatDate(value);
}

export const SEVERITY_STYLES: Record<string, string> = {
  LOW: 'bg-base-700 text-slate-300',
  MEDIUM: 'bg-warning/15 text-warning',
  HIGH: 'bg-orange-500/15 text-orange-300',
  CRITICAL: 'bg-danger/15 text-danger',
};

export const ACTION_STYLES: Record<string, string> = {
  BAN: 'bg-danger/15 text-danger',
  KICK: 'bg-orange-500/15 text-orange-300',
  TIMEOUT: 'bg-warning/15 text-warning',
  WARN: 'bg-yellow-500/15 text-yellow-300',
  NOTE: 'bg-base-700 text-slate-300',
};
