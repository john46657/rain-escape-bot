# REST-API

Basis: `https://<host>/api/v1` · Alle Antworten sind JSON.

## Authentifizierung

**API-Key** (Maschinen):

```http
Authorization: Bearer nxs_live_xxxxxxxxxxxxxxxxxxxx
```

**Session-Cookie** (Dashboard): wird durch den OAuth-Fluss gesetzt und ist
`httpOnly`.

Schluessel werden nur als SHA-256-Hash gespeichert. Der Klartext erscheint
ausschliesslich in der Antwort auf die Erstellung.

## Antwortformat

```jsonc
// Erfolg
{ "data": { … }, "meta": { "total": 42, "page": 1, "pageSize": 25 } }

// Fehler
{ "error": { "code": "FORBIDDEN", "message": "Scope \"guilds:write\" fehlt", "requestId": "req_…" } }
```

| Code           | HTTP | Bedeutung                                              |
| -------------- | ---- | ------------------------------------------------------ |
| `VALIDATION`   | 400  | Eingabe ungueltig (Details im Feld `details`)          |
| `UNAUTHORIZED` | 401  | Kein oder ungueltiges Authentifizierungsmerkmal        |
| `FORBIDDEN`    | 403  | Merkmal gueltig, Berechtigung fehlt                    |
| `NOT_FOUND`    | 404  | Ressource existiert nicht                              |
| `CONFLICT`     | 409  | Zustandskonflikt (z. B. bereits verknuepft)            |
| `RATE_LIMITED` | 429  | Grenze erreicht                                        |
| `INTERNAL`     | 500  | Unerwarteter Fehler — `requestId` beim Support angeben |

## Scopes

`guilds:read`, `guilds:write`, `moderation:read`, `security:read`,
`tickets:read`, `levels:read`, `analytics:read`, `audit:read`, `roblox:read`

## Endpunkte

### Systemzustand

| Methode | Pfad            | Beschreibung                   |
| ------- | --------------- | ------------------------------ |
| `GET`   | `/health/live`  | Prozess laeuft                 |
| `GET`   | `/health/ready` | Datenbank und Cache erreichbar |

### Server

| Methode | Pfad                                  | Scope             |
| ------- | ------------------------------------- | ----------------- |
| `GET`   | `/api/v1/guilds`                      | `guilds:read`     |
| `GET`   | `/api/v1/guilds/:guildId`             | `guilds:read`     |
| `PATCH` | `/api/v1/guilds/:guildId/config`      | `guilds:write`    |
| `GET`   | `/api/v1/guilds/:guildId/cases`       | `moderation:read` |
| `GET`   | `/api/v1/guilds/:guildId/incidents`   | `security:read`   |
| `GET`   | `/api/v1/guilds/:guildId/tickets`     | `tickets:read`    |
| `GET`   | `/api/v1/guilds/:guildId/audit`       | `audit:read`      |
| `GET`   | `/api/v1/guilds/:guildId/leaderboard` | `levels:read`     |
| `GET`   | `/api/v1/guilds/:guildId/analytics`   | `analytics:read`  |
| `GET`   | `/api/v1/guilds/:guildId/roblox`      | `roblox:read`     |

Listen unterstuetzen `?page=` und `?pageSize=` (max. 100).

### Entwicklerportal

| Methode  | Pfad                           | Hinweis                                    |
| -------- | ------------------------------ | ------------------------------------------ |
| `GET`    | `/api/v1/guilds/:guildId/keys` | nur Metadaten, nie der Schluessel          |
| `POST`   | `/api/v1/guilds/:guildId/keys` | Antwort enthaelt den Klartext genau einmal |
| `DELETE` | `/api/v1/keys/:keyId`          | widerruft sofort                           |
| `GET`    | `/api/v1/keys/:keyId/requests` | letzte 50 Aufrufe                          |

```bash
curl -X POST "$NEXUS_API/api/v1/guilds/$GUILD/keys" \
  -H 'content-type: application/json' \
  -d '{"name":"Statistik-Export","scopes":["guilds:read","analytics:read"]}'
```

### Roblox (signiert)

Diese Endpunkte verwenden **nicht** den `Authorization`-Header, sondern das
Signaturprotokoll (siehe `docs/SECURITY.md`).

| Methode | Pfad                           | Zweck                                 |
| ------- | ------------------------------ | ------------------------------------- |
| `POST`  | `/api/v1/roblox/handshake`     | Zugangsdaten pruefen, Zeit abgleichen |
| `POST`  | `/api/v1/roblox/heartbeat`     | Serverzustand melden                  |
| `POST`  | `/api/v1/roblox/events`        | Ereignisse uebertragen (idempotent)   |
| `POST`  | `/api/v1/roblox/verify`        | Verifizierungscode einloesen          |
| `POST`  | `/api/v1/roblox/commands`      | Kommandos abholen                     |
| `POST`  | `/api/v1/roblox/commands/ack`  | Ausfuehrung bestaetigen               |
| `POST`  | `/api/v1/roblox/rewards/claim` | Belohnung anfordern (idempotent)      |

### Echtzeit

`GET /api/v1/realtime?guildId=…` (WebSocket)

```jsonc
{ "topic": "moderation.case", "payload": { … }, "at": 1735689600000 }
```

Themen: `moderation.case`, `security.incident`, `security.automod`,
`security.lockdown`, `ticket.created`, `ticket.closed`, `roblox.event`,
`roblox.heartbeat`, `roblox.verified`, `levels.levelup`, `config.updated`.

## Grenzwerte

| Bereich               | Standard               |
| --------------------- | ---------------------- |
| HTTP je IP/Schluessel | 120 Anfragen/Minute    |
| Roblox je Spiel       | 240 Anfragen/Minute    |
| Verifizierung         | 5 Versuche / 5 Minuten |
| Ereignisse je Anfrage | 50                     |
| Koerpergroesse        | 1 MB                   |
