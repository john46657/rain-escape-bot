/**
 * Helfer fuer JSON-Text-Spalten (siehe Kommentar in schema.prisma).
 * Fehlerhafte Inhalte fuehren nie zu einem Absturz, sondern zum Fallback.
 */
export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}
