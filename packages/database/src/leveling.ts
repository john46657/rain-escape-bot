/**
 * XP-/Level-Mathematik (Regel 12).
 * Formel je Level: 5 * L^2 + 50 * L + 100 (progressiv, aber erreichbar).
 */
export function xpForLevel(level: number): number {
  return 5 * level * level + 50 * level + 100;
}

export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let index = 0; index < level; index++) total += xpForLevel(index);
  return total;
}

/** Ermittelt Level und Rest-XP aus der Gesamt-XP. */
export function levelFromTotalXp(totalXp: number): { level: number; xpIntoLevel: number; xpForNext: number } {
  let level = 0;
  let remaining = Math.max(0, totalXp);
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level++;
    if (level > 1000) break; // Sicherheitsnetz gegen Endlosschleifen
  }
  return { level, xpIntoLevel: remaining, xpForNext: xpForLevel(level) };
}
