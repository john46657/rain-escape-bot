# Architektur

Dieses Dokument erklaert den Aufbau von NEXUS und die Gruende fuer die
wichtigsten Entwurfsentscheidungen.

## Ueberblick

```
                    ┌──────────────┐
   Discord ────────▶│   apps/bot   │─────┐
                    └──────────────┘     │
                                         │  Redis Pub/Sub
   Roblox ─────────▶┌──────────────┐◀────┘  (Ereignisbus)
   (signiert)       │   apps/api   │
                    └──────┬───────┘
                           │ REST + WebSocket
                    ┌──────▼───────┐
   Browser ────────▶│apps/dashboard│
                    └──────────────┘

           PostgreSQL (Prisma)      Redis (Cache, Locks, Rate Limits)
```

Bot und API sind eigenstaendige Prozesse. Sie teilen sich Datenbank und Cache,
kommunizieren aber nur ueber den Ereignisbus. Dadurch kann die API neu starten,
ohne dass der Bot Verbindungen zu Discord verliert — und umgekehrt.

## Warum ein Monorepo mit npm-Workspaces?

Bot, API und Dashboard teilen sich Typen, Fehlerklassen, Berechtigungsknoten und
das Datenmodell. Getrennte Repositorys wuerden diese Vertraege duplizieren.
npm-Workspaces genuegen; ein zusaetzliches Werkzeug (pnpm, Turborepo) waere hier
Mehraufwand ohne Nutzen.

Interne Pakete sind **quellcodebasiert**: `main` zeigt auf `src/index.ts`,
TypeScript loest ueber `paths` auf, und esbuild buendelt fuer die Produktion.
Es gibt also keinen Build-Schritt pro Paket und keine veralteten `dist`-Ordner.

## Datenschicht: Ports und Adapter

`packages/database` besteht aus vier Teilen:

| Datei                        | Inhalt                                                                    |
| ---------------------------- | ------------------------------------------------------------------------- |
| `prisma/schema.prisma`       | Das physische Schema (~40 Modelle)                                        |
| `src/entities.ts`            | Handgeschriebene Domaenentypen — JSON-Spalten sind hier bereits typisiert |
| `src/ports.ts`               | Repository-Schnittstellen, gebuendelt im `DataStore`                      |
| `src/prisma/`, `src/memory/` | Zwei Adapter mit identischer Semantik                                     |

**Begruendung**

1. _Entkopplung._ Kein Modul importiert generierte Prisma-Typen. Ein Wechsel des
   ORM oder eine Denormalisierung bleibt lokal.
2. _Testbarkeit._ Der In-Memory-Adapter macht die Testsuite schnell und
   deterministisch — ohne Docker, ohne Migrationen.
3. _Lauffaehigkeit ohne Infrastruktur._ Derselbe Adapter treibt den `DEV_MODE`
   und damit die Demo des Dashboards.

Damit die Tests aussagekraeftig bleiben, bildet der In-Memory-Adapter die
Zusicherungen des Prisma-Adapters exakt nach: lueckenlose Fallnummern,
Idempotenzschluessel, Ablehnung von Ueberziehungen, einmalige Auslieferung von
Kommandos.

### Portabilitaetsregeln des Schemas

- keine nativen Enums (Strings mit dokumentierter Wertemenge)
- keine skalaren Arrays und kein `Json`-Typ — JSON wird als `String` gespeichert
  und beim Lesen validiert
- keine `@db.*`-Annotationen
- fuer jeden Abfragepfad ein Index
- Secrets ausschliesslich als Hash

Diese Regeln halten das Schema zwischen PostgreSQL und SQLite portabel, ohne
dass zwei Schemadateien gepflegt werden muessen.

### Nebenlaeufigkeit

| Invariante                           | Umsetzung                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| Fallnummern lueckenlos und eindeutig | Transaktion + Unique-Index `(guildId, sequence)` + Wiederholung bei Kollision     |
| Keine Doppelbuchung                  | `Transaction.idempotencyKey` ist eindeutig; Pruefung innerhalb der Transaktion    |
| Keine verlorenen Updates             | Bedingtes `updateMany` mit Guard auf Saldo und `version` (optimistisches Locking) |
| Belohnungen genau einmal             | `RewardGrant.idempotencyKey` eindeutig; `grant()` meldet `created`                |
| Roblox-Ereignisse einmalig           | `RobloxEvent.eventId` eindeutig; Duplikate werden als solche gemeldet             |
| Kommandos einmalig ausgeliefert      | Transaktion: `findMany` → `updateMany(status: PENDING)` → erneut lesen            |

## Bot-Kern

`apps/bot/src/core` stellt allen Modulen dieselbe Grundlage bereit:

- **Container** — ein einziges `Services`-Objekt statt globaler Singletons.
- **Registry** — sammelt Befehle, Handler, Ereignisse und Jobs; erkennt
  Kollisionen beim Start.
- **Router** — einziger Einstiegspunkt fuer Interaktionen. Er erledigt in fester
  Reihenfolge: Kontext (Sprache, Konfiguration) → DM-Sperre → Blacklist →
  Rate-Limit → Premium-Pruefung → Berechtigung → Cooldown → Ausfuehrung.
  Fehler landen zentral: erwartete Fehler werden erklaert, unerwartete erhalten
  eine Referenz-ID, die im Log wiederauffindbar ist.
- **Scheduler** — wiederkehrende Aufgaben; `singleton`-Jobs laufen ueber einen
  verteilten Redis-Lock nur einmal im Cluster.
- **GuildContext** — Konfiguration, Premium-Tier und Berechtigungen mit Cache.

Ein Modul ist ein Objekt:

```ts
const module: NexusModule = {
  name: 'moderation',
  description: '…',
  commands: [...],
  components: [...],
  events: [...],
  jobs: [...],
};
```

Die Modulliste in `apps/bot/src/modules.ts` ist bewusst statisch: kein
Verzeichnis-Scan, dafuer Typpruefung und ein bundlebares Ergebnis.

## API

Fastify als Factory (`buildServer`), damit Tests ohne offenen Port arbeiten
koennen. Besonderheiten:

- Ein eigener Content-Type-Parser bewahrt den **Rohkoerper** — die
  Roblox-Signatur bezieht sich auf exakt diese Bytes.
- Zwei Authentifizierungswege: API-Key (Maschinen) und Session-Cookie (Menschen).
- Einheitliches Fehlerformat mit `requestId`; 5xx-Details bleiben serverseitig.
- WebSocket-Route spiegelt den Redis-Bus gefiltert nach Server an den Browser.

## Dashboard

Next.js App Router mit Server-Komponenten: Datenabruf passiert auf dem Server,
der Browser erhaelt kein Token und keine interne Adresse. Client-Komponenten
gibt es nur dort, wo Interaktivitaet noetig ist (Befehlszentrale, Live-Feed,
Diagramme). Alle `/api`-Pfade werden serverseitig zur API weitergeleitet —
der Browser spricht ausschliesslich mit seiner eigenen Herkunft.

## Fehlerbehandlung

Alle Fehler stammen von `NexusError` mit Code, HTTP-Status und der Angabe, ob
sie _erwartet_ sind. Erwartete Fehler (fehlende Rechte, zu wenig Guthaben,
Rate-Limit) erzeugen eine hilfreiche Nutzermeldung ohne Stacktrace; unerwartete
Fehler werden mit Referenz-ID geloggt. Discord-API-Fehler werden in verstaendliche
Meldungen uebersetzt (`wrapDiscordError`).
