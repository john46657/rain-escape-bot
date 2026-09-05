# Mitwirken

## Einrichtung

```bash
npm install
cp .env.example .env      # DEV_MODE=true genuegt fuer den Einstieg
npm test
```

## Vor jedem Commit

```bash
npm run typecheck      # muss fehlerfrei sein
npm run lint
npm run check:schema   # Prisma-Schema, laeuft ohne Netzwerk
npm test
```

Dieselben Schritte laufen in der CI (`.github/workflows/ci.yml`), zusaetzlich
`prettier --check`, beide Produktions-Bundles und ein Startversuch der API.

## Grundsaetze

1. **Keine erfundenen Funktionen.** Wenn eine Plattform etwas nicht erlaubt,
   wird das dokumentiert — nicht vorgetaeuscht.
2. **Kein sicherheitsrelevanter Pfad ohne Berechtigungspruefung.**
   Jede solche Aktion ruft `requirePermission` bzw. `guildContext.assert` auf.
3. **Kein Secret im Klartext.** Weder in der Datenbank, noch im Log, noch im
   Frontend.
4. **Kommentare erklaeren das Warum.** Was der Code tut, steht im Code.
5. **Deutsch fuer Dokumentation und Kommentare**, Englisch fuer Bezeichner.
6. **Fehler sind Werte.** `NexusError` mit Code und `expected`-Flag statt
   generischer `Error`.

## Neues Modul

Siehe `docs/MODULES.md`, Abschnitt „Eigenes Modul anlegen“.

## Tests

Kritische Pfade brauchen Tests: Signaturen, Berechtigungen, Geldbewegungen,
Idempotenz, Fallnummern. Der In-Memory-Datenspeicher macht das ohne
Infrastruktur moeglich.

## Commit-Nachrichten

```
<typ>(<bereich>): <kurzbeschreibung>

feat(moderation): Massenban mit Fortschrittsanzeige
fix(economy): doppelte Gutschrift bei Retry verhindert
docs(roblox): Hinweis zu Studio-HTTP-Einstellung
```
