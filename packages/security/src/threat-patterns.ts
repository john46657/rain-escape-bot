/**
 * Heuristiken fuer AutoMod (Regel 6).
 *
 * Bewusst konservativ gehalten: Erkennungen fuehren zu konfigurierbaren
 * Aktionen, nicht automatisch zu Banns. Falsch-Positive muessen guenstig sein.
 */
export const INVITE_PATTERN =
  /(?:discord(?:app)?\.com\/invite|discord\.gg|discord\.me|dsc\.gg|invite\.gg)\/[a-z0-9-]{2,32}/gi;

export const URL_PATTERN = /https?:\/\/[^\s<]+|(?:^|\s)(?:www\.)[^\s<]+/gi;

/** Bekannte Muster von Scam-/Phishing-Nachrichten (Textheuristik). */
export const SCAM_PHRASES: readonly RegExp[] = [
  /free\s+(nitro|robux|steam\s+gift)/i,
  /kostenlose?\s+(nitro|robux)/i,
  /claim\s+your\s+(free|gift)/i,
  /steamcommunity\s*\.\s*(?!com)/i,
  /(?:airdrop|giveaway)\s+(?:bot|claim)\s+now/i,
  /verify\s+your\s+account\s+to\s+(?:claim|receive)/i,
  /\b(?:robux|rbx)\s*(?:generator|hack|free)\b/i,
];

/** Typosquatting-Domains fuer Discord/Roblox/Steam. */
export const PHISHING_HOST_PATTERNS: readonly RegExp[] = [
  /(?:^|\.)disc[o0]rd[^.]*\.(?:gift|gg|ru|xyz|cf|tk|ml|link|click|app)$/i,
  /(?:^|\.)d[il]scord(?:app)?\.(?:com|net|org)$/i,
  /(?:^|\.)r[o0]bl[o0]x[^.]*\.(?:ru|xyz|cf|tk|ml|link|click|gift)$/i,
  /(?:^|\.)steamcommunlty\./i,
  /(?:^|\.)nitro[- ]?(?:free|gift|claim)[^.]*\./i,
];

const LEGIT_HOSTS = new Set([
  'discord.com', 'discordapp.com', 'discord.gg', 'discord.media',
  'roblox.com', 'rbxcdn.com', 'steamcommunity.com', 'youtube.com', 'youtu.be',
]);

export function extractHosts(content: string): string[] {
  const hosts: string[] = [];
  for (const match of content.matchAll(URL_PATTERN)) {
    const raw = match[0].trim();
    try {
      const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
      hosts.push(url.hostname.toLowerCase());
    } catch {
      /* ungueltige URL ignorieren */
    }
  }
  return hosts;
}

export function isPhishingHost(host: string): boolean {
  const normalized = host.replace(/^www\./, '');
  if (LEGIT_HOSTS.has(normalized)) return false;
  return PHISHING_HOST_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function scamScore(content: string): number {
  let score = 0;
  for (const phrase of SCAM_PHRASES) if (phrase.test(content)) score += 0.4;
  for (const host of extractHosts(content)) if (isPhishingHost(host)) score += 0.6;
  if (/@everyone|@here/.test(content) && /https?:\/\//.test(content)) score += 0.25;
  return Math.min(1, score);
}

/** Anteil an Grossbuchstaben (ignoriert Zahlen/Sonderzeichen/Emojis). */
export function capsRatio(content: string): number {
  const letters = content.replace(/[^a-zA-ZäöüÄÖÜß]/g, '');
  if (letters.length < 8) return 0;
  const upper = letters.replace(/[^A-ZÄÖÜ]/g, '').length;
  return upper / letters.length;
}

/** Normalisiert Leetspeak/Zero-Width-Tricks fuer den Wortfilter. */
export function normalizeForFilter(content: string): string {
  return content
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u200b-\u200f\u2060]/g, '')
    .replace(/[0]/g, 'o').replace(/[1!|]/g, 'i').replace(/[3]/g, 'e')
    .replace(/[4@]/g, 'a').replace(/[5$]/g, 's').replace(/[7]/g, 't')
    .replace(/[^a-z0-9äöüß\s]/g, '')
    .replace(/(.)\1{2,}/g, '$1$1')
    .replace(/\s+/g, ' ')
    .trim();
}
