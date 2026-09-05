# NEXUS

**Die Verwaltungsplattform für Discord-Server mit Roblox-Spielen.**

NEXUS verbindet einen Discord-Server und beliebig viele Roblox-Erlebnisse zu einem System:
Moderation mit lückenloser Fallhistorie, aktiver Angriffsschutz, Support-Tickets, Level und
Wirtschaft, verifizierte Roblox-Konten, Live-Serverüberwachung, Fernsteuerung der Spielserver
und ein Dashboard mit Echtzeit-Aktualisierung.

> Sprache: Dokumentation und Code-Kommentare sind auf Deutsch, Bezeichner im Code auf Englisch.
> Die Bot-Oberfläche spricht Deutsch und Englisch.

---

## Inhalt

- [Schnellstart (ohne Datenbank)](#schnellstart-ohne-datenbank)
- [Vollständige Installation](#vollständige-installation)
- [Architektur](#architektur)
- [Funktionsumfang](#funktionsumfang)
- [Sicherheitskonzept](#sicherheitskonzept)
- [Roblox-Anbindung](#roblox-anbindung)
- [Entwicklung](#entwicklung)
- [Ehrliche Einordnung](#ehrliche-einordnung)

---

## Schnellstart (ohne Datenbank)

Für einen ersten Blick genügen Node.js 22 und npm. PostgreSQL, Redis und Docker
werden **nicht** benötigt: `DEV_MODE=true` schaltet auf einen In-Memory-Datenspeicher
und einen In-Memory-Cache um und lädt einen Demo-Datensatz.

```bash
npm install
cp .env.example .env          # DEV_MODE=true ist bereits gesetzt
npm run dev:api               # API auf http://localhost:4000
npm run dev:dashboard         # Dashboard auf http://localhost:3000
```

Das Dashboard zeigt anschließend den Demo-Server mit Moderationsfällen, Sicherheitsvorfällen,
Tickets, Roblox-Serverinstanzen und 30 Tagen Statistik.

Für den Bot wird zusätzlich ein Discord-Token benötigt:

```bash
# .env: DISCORD_TOKEN, DISCORD_CLIENT_ID und DISCORD_DEV_GUILD_ID eintragen
npm run deploy:commands       # Slash-Commands registrieren
npm run dev:bot
```

---

## Vollständige Installation

### Voraussetzungen

| Komponente | Version | Zweck |
| --- | --- | --- |
| Node.js | ≥ 22 | Laufzeit aller Dienste |
| PostgreSQL | ≥ 15 | Primärdatenbank |
| Redis | ≥ 7 | Cache, Rate Limits, verteilte Locks, Ereignisbus |
| Docker | optional | Bereitstellung des gesamten Stacks |

### Discord-Anwendung vorbereiten

1. Anwendung im [Discord Developer Portal](https://discord.com/developers/applications) erstellen.
2. Unter **Bot** das Token erzeugen (`DISCORD_TOKEN`).
3. Unter **Bot → Privileged Gateway Intents** aktivieren:
   - **Server Members Intent** — Beitritte, Rollensynchronisation, Verifizierung
   - **Message Content Intent** — AutoMod und XP-Vergabe
4. Unter **OAuth2** `DISCORD_CLIENT_SECRET` kopieren und
   `http://localhost:4000/auth/callback` als Redirect hinterlegen.
5. Bot mit den Scopes `bot applications.commands` einladen.

### Datenbank einrichten

```bash
docker compose -f docker/docker-compose.dev.yml up -d   # Postgres + Redis
npm run db:generate                                     # Prisma-Client erzeugen
npm run db:migrate                                      # Schema anwenden
```

### Produktivbetrieb

```bash
cd docker
docker compose up -d --build
```

Der Stack startet Postgres, Redis, Migrationen, API, Bot und Dashboard.
Alle Dienste besitzen Healthchecks, laufen als unprivilegierter Benutzer und
starten bei Fehlern automatisch neu.

---

## Architektur

```
nexus/
├── apps/
│   ├── bot/           Discord-Bot (discord.js 14, Sharding, Slash-Commands)
│   ├── api/           REST-API + WebSocket (Fastify 5)
│   └── dashboard/     Web-Oberfläche (Next.js 15, React 19, Tailwind)
├── packages/
│   ├── shared/        Fehler, Zeit, IDs, Typen, Retry, Redaction
│   ├── logger/        Strukturiertes Logging mit Secret-Filter
│   ├── config/        Zod-validierte Umgebung, Premium-Funktionen
│   ├── cache/         Redis-Abstraktion + In-Memory-Treiber
│   ├── database/      Prisma-Schema, Domänentypen, Ports & Adapter
│   ├── permissions/   Berechtigungsknoten und Auswertung
│   ├── security/      Signaturen, Replay-Schutz, Tokens, Bedrohungsmuster
│   └── roblox-sdk/    Roblox-Client (TS) + Luau-SDK für das Spiel
├── modules/           14 Fachmodule (Moderation, Security, Tickets, …)
├── docker/            Dockerfiles und Compose-Dateien
├── docs/              Ausführliche Dokumentation
└── tests/             Unit- und Integrationstests (Vitest)
```

**Zentrale Entwurfsentscheidungen**

- **Ports & Adapter für Daten.** Module kennen ausschließlich handgeschriebene
  Domänentypen und Repository-Schnittstellen (`packages/database/src/ports.ts`).
  Dahinter stehen zwei Adapter: Prisma/PostgreSQL für den Betrieb und
  In-Memory für Tests und Demos. Das hält Fachlogik von der ORM-Wahl frei und
  macht die Testsuite schnell und deterministisch.
- **Module als Bündel.** Ein Modul liefert Befehle, Komponenten-Handler,
  Ereignis-Handler und Hintergrundaufgaben in einem Objekt. Die Registry erkennt
  Namenskollisionen beim Start statt zur Laufzeit.
- **Ein Weg für jede Aktion.** Jede Moderationsmaßnahme durchläuft denselben
  Pfad: Berechtigung → Discord-Rechte → Hierarchie → Ausführung → Fall → DM →
  Mod-Log → Audit → Ereignis.
- **Der Bot spricht nie direkt mit dem Browser.** Der Ereignisfluss lautet
  Bot → Redis-Bus → API → WebSocket → Dashboard.

---

## Funktionsumfang

| Bereich | Umfang |
| --- | --- |
| **Moderation** | Ban/Tempban, Softban, Kick, Timeout, Warn (mit Ablauf), Notizen, Clear, Slowmode, Lock/Unlock, Nickname, Rollen, Fallhistorie mit ID `NX-xxxx-nnnnnn`, Kontextmenü |
| **Sicherheit** | AutoMod (Spam, Flood, Caps, Invites, Links, Mentions, Scam, Phishing, Wortfilter), Anti-Nuke mit Entmachtung, Raid-Erkennung, Mindest-Kontoalter, Notfallmodus mit exakter Wiederherstellung, Vorfallverwaltung |
| **Tickets** | Panel mit Auswahlmenü, Modal-Formular, Claim/Close/Reopen, Transkript als Datei, Limit pro Nutzer |
| **Community** | Willkommen/Abschied mit Platzhaltern, Autorollen, Vorschläge mit Abstimmung, Umfragen, Starboard, AFK |
| **Level** | XP pro Nachricht mit Cooldown, Rollen- und Münzbelohnungen, Rangliste, Administration |
| **Wirtschaft** | Geldbeutel/Bank, Daily mit Streak, Work, Transfer, Shop, Inventar, Rangliste — alle Buchungen atomar und idempotent |
| **Spiele** | Coinflip, Würfel, Slots, Schere-Stein-Papier, Magische Kugel (mit Einsatz) |
| **Gewinnspiele** | Erstellung, Teilnahme per Button, automatische Ziehung, Reroll |
| **Roblox** | Verifizierung per Einmalcode, Profilabruf, Gruppensynchronisation, Server-Monitor, Ankündigungen, Kick/Ban/Shutdown, plattformübergreifende Belohnungen |
| **Automation** | Trigger → Bedingungen → Aktionen mit Rate-Limit und Fehlerzählung |
| **Analytics** | Tagesaggregate, Dashboard-Diagramme, Zusammenfassung |
| **Backups** | Snapshot von Rollen und Kanälen, nicht-destruktive Wiederherstellung |
| **KI** *(optional)* | Frage-Antwort über eine OpenAI-kompatible API |
| **Musik** *(Gerüst)* | Befehle vorhanden; benötigt einen Lavalink-Knoten |

---

## Sicherheitskonzept

**Berechtigungen.** Statt grober Rollenprüfungen existieren feingranulare Knoten
(`discord.moderation.ban`, `roblox.server.shutdown`, `dashboard.developers.manage`, …).
Die Auswertung erfolgt in fester Reihenfolge:

1. Bot-Owner → erlaubt
2. Ausdrückliches DENY → verweigert (schlägt auch Administratoren)
3. Server-Owner → erlaubt
4. Ausdrückliches ALLOW (Nutzer oder Rolle, Wildcards möglich) → erlaubt
5. Discord-Administrator → erlaubt für Standardknoten, **nicht** für Entwicklerfunktionen
6. sonst verweigert

**Bestätigungen.** Ban, Lockdown, Backup-Wiederherstellung, Roblox-Bann und
Server-Shutdown erfordern eine explizite Bestätigung mit Kontextanzeige.

**Secrets.** API-Keys werden ausschließlich als SHA-256-Hash gespeichert, dazu
Präfix und letzte vier Zeichen zur Wiedererkennung — ein erneutes Anzeigen ist
technisch ausgeschlossen. Verifizierungscodes (geringe Entropie) nutzen scrypt.
Logs filtern Token, Passwörter und Signaturen automatisch heraus.

**Audit.** Jede sicherheitsrelevante Aktion aus Discord, Dashboard, API und
Roblox landet unveränderlich im Audit-Log — mit Akteur, Quelle, Ziel, Ergebnis
und Begründung.

---

## Roblox-Anbindung

Die Kommunikation zwischen Game-Server und NEXUS ist signiert:

```
Kanonische Zeichenkette = METHOD \n PATH \n TIMESTAMP \n NONCE \n BODY
Signatur                = HMAC-SHA256(ROBLOX_SIGNING_SECRET, kanonische Zeichenkette)
```

Geprüft werden Signatur (zeitkonstanter Vergleich), Zeitfenster (Standard 300 s),
Einmaligkeit der Nonce (Replay-Schutz) und ein Rate-Limit pro Spiel.

Da Roblox kein HMAC bereitstellt, enthält `packages/roblox-sdk/luau/NexusCrypto.luau`
eine vollständige SHA-256- und HMAC-SHA256-Implementierung in reinem Luau,
inklusive Selbsttest gegen die offiziellen Testvektoren (FIPS 180-4, RFC 4231).

**Verifizierung ohne Vertrauensbruch:** `/verify` erzeugt einen Einmalcode, von
dem nur ein Hash gespeichert wird. Der Spieler gibt ihn im Spiel ein; der
Game-Server sendet ihn zusammen mit `Player.UserId` signiert an die API. Die
Roblox-Identität stammt damit immer vom Server, nie aus einer Client-Eingabe.

Einzelheiten: [`docs/ROBLOX.md`](docs/ROBLOX.md)

---

## Entwicklung

```bash
npm run dev            # Bot, API und Dashboard parallel
npm run typecheck      # Strenge TypeScript-Prüfung über alles
npm run lint           # ESLint
npm run format         # Prettier
npm test               # Vitest (60 Tests)
npm run test:coverage  # mit Abdeckungsbericht
npm run build          # Produktions-Bundles
```

Weiterführend: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[`docs/API.md`](docs/API.md), [`docs/SECURITY.md`](docs/SECURITY.md),
[`docs/MODULES.md`](docs/MODULES.md), [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

---

## Ehrliche Einordnung

Damit klar ist, was das System leistet und was nicht:

- **Discord kann Aktionen nicht rückgängig machen.** Anti-Nuke erkennt einen
  Angriff, entzieht dem Verursacher die Rollen, sperrt den Server und alarmiert.
  Bereits gelöschte Kanäle stellt nur ein Backup wieder her.
- **Ohne die Berechtigung „Audit-Log einsehen“** lässt sich der Verursacher eines
  Gateway-Ereignisses nicht ermitteln. NEXUS alarmiert dann, bestraft aber nicht.
- **Das Musikmodul ist ein Gerüst.** Audiowiedergabe erfordert einen externen
  Knoten (Lavalink); ohne Konfiguration meldet das Modul das offen.
- **Das KI-Modul ist optional** und spricht eine OpenAI-kompatible API an.
- **Open Cloud ist optional.** Ohne API-Key nutzt NEXUS Polling statt
  MessagingService-Push — funktional gleichwertig, nur wenige Sekunden langsamer.
- **`DEV_MODE` ist kein Produktionsmodus.** Er hält alle Daten im Arbeitsspeicher
  und akzeptiert Dashboard-Zugriffe ohne Anmeldung. Für den Betrieb gilt
  PostgreSQL + Redis + Discord-OAuth.
