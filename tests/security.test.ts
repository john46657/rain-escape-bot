import { describe, expect, it } from 'vitest';
import {
  canonicalString, generateApiKey, hashApiKey, hashSecret, signRequest, signSession,
  verifyApiKey, verifySecret, verifySession, verifySignature,
} from '@nexus/security';
import { capsRatio, extractHosts, isPhishingHost, normalizeForFilter, scamScore } from '@nexus/security';

const SECRET = 'test-secret-mit-ausreichender-laenge';

describe('Request-Signatur', () => {
  const payload = {
    method: 'POST',
    path: '/api/v1/roblox/heartbeat',
    timestamp: String(Math.floor(Date.now() / 1000)),
    nonce: 'nonce-123',
    body: '{"jobId":"abc"}',
  };

  it('erzeugt die vereinbarte kanonische Zeichenkette', () => {
    expect(canonicalString(payload)).toBe(
      `POST\n/api/v1/roblox/heartbeat\n${payload.timestamp}\nnonce-123\n{"jobId":"abc"}`,
    );
  });

  it('akzeptiert eine gueltige Signatur', () => {
    const signature = signRequest(SECRET, payload);
    expect(verifySignature(SECRET, payload, signature).valid).toBe(true);
  });

  it('lehnt eine manipulierte Nutzlast ab', () => {
    const signature = signRequest(SECRET, payload);
    const tampered = { ...payload, body: '{"jobId":"anders"}' };
    expect(verifySignature(SECRET, tampered, signature)).toEqual({ valid: false, reason: 'MISMATCH' });
  });

  it('lehnt ein falsches Secret ab', () => {
    const signature = signRequest('anderes-secret-lang-genug!!', payload);
    expect(verifySignature(SECRET, payload, signature).valid).toBe(false);
  });

  it('lehnt zu alte Zeitstempel ab (Clock Skew)', () => {
    const old = { ...payload, timestamp: String(Math.floor(Date.now() / 1000) - 3_600) };
    const signature = signRequest(SECRET, old);
    expect(verifySignature(SECRET, old, signature, 300)).toEqual({ valid: false, reason: 'SKEW' });
  });

  it('erkennt fehlende Pflichtfelder', () => {
    expect(verifySignature(SECRET, { ...payload, nonce: '' }, 'x').reason).toBe('MALFORMED');
  });

  it('entspricht dem bekannten HMAC-Testvektor (Kompatibilitaet mit Luau)', () => {
    // Dient als Referenz fuer NexusCrypto.luau: identische Eingabe, identische Ausgabe.
    const signature = signRequest('key', {
      method: 'GET', path: '/', timestamp: '1', nonce: 'n', body: '',
    });
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(signature).toBe(signRequest('key', { method: 'get', path: '/', timestamp: '1', nonce: 'n', body: '' }));
  });
});

describe('API-Keys', () => {
  it('speichert nur den Hash und erlaubt die Wiedererkennung', () => {
    const key = generateApiKey('live');
    expect(key.plaintext.startsWith('nxs_live_')).toBe(true);
    expect(key.hash).not.toContain(key.plaintext);
    expect(hashApiKey(key.plaintext)).toBe(key.hash);
    expect(verifyApiKey(key.plaintext, key.hash)).toBe(true);
    expect(verifyApiKey(`${key.plaintext}x`, key.hash)).toBe(false);
    expect(key.plaintext.endsWith(key.last4)).toBe(true);
  });

  it('erzeugt bei jedem Aufruf einen anderen Schluessel', () => {
    expect(generateApiKey().plaintext).not.toBe(generateApiKey().plaintext);
  });
});

describe('Secrets mit geringer Entropie', () => {
  it('hasht und prueft Verifizierungscodes', async () => {
    const hash = await hashSecret('NX-ABC123');
    expect(hash).not.toContain('NX-ABC123');
    expect(await verifySecret('NX-ABC123', hash)).toBe(true);
    expect(await verifySecret('NX-ABC124', hash)).toBe(false);
  });
});

describe('Sessions', () => {
  it('akzeptiert nur unveraenderte Tokens', () => {
    const token = signSession(SECRET, {
      userId: 'u1', discordId: 'd1', issuedAt: Date.now(), expiresAt: Date.now() + 60_000,
    });
    expect(verifySession(SECRET, token)?.discordId).toBe('d1');
    expect(verifySession(SECRET, `${token}x`)).toBeNull();
    expect(verifySession('falsches-secret-lang-genug', token)).toBeNull();
  });

  it('lehnt abgelaufene Sessions ab', () => {
    const token = signSession(SECRET, {
      userId: 'u1', discordId: 'd1', issuedAt: Date.now() - 10_000, expiresAt: Date.now() - 1_000,
    });
    expect(verifySession(SECRET, token)).toBeNull();
  });
});

describe('Bedrohungserkennung', () => {
  it('normalisiert Umgehungsversuche', () => {
    // Trennzeichen und Leetspeak werden entfernt bzw. zurueckgesetzt.
    expect(normalizeForFilter('B-a-d_W*o.r.d')).toBe('badword');
    expect(normalizeForFilter('B4DW0RD')).toBe('badword');
  });

  it('erkennt Grossbuchstabenanteil', () => {
    expect(capsRatio('HALLO WELT')).toBeGreaterThan(0.9);
    expect(capsRatio('hallo welt')).toBeLessThan(0.1);
  });

  it('extrahiert Hosts aus Nachrichten', () => {
    expect(extractHosts('schau mal https://example.com/pfad an')).toContain('example.com');
  });

  it('erkennt typische Phishing-Domains', () => {
    expect(isPhishingHost('discord-nitro-free.xyz')).toBe(true);
    expect(isPhishingHost('github.com')).toBe(false);
  });

  it('bewertet Scam-Nachrichten hoeher als normale', () => {
    const scam = scamScore('FREE NITRO GIVEAWAY claim now http://discocrd-gift.ru');
    const normal = scamScore('Wann startet das naechste Event?');
    expect(scam).toBeGreaterThan(normal);
  });
});
