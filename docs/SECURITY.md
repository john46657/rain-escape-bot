# Sicherheitskonzept

## Berechtigungsmodell

NEXUS prueft nie "hat Administrator", sondern immer einen konkreten Knoten.

```
<plattform>.<bereich>.<aktion>

discord.moderation.ban
discord.security.lockdown
roblox.server.shutdown
dashboard.developers.manage
```

Wildcards sind erlaubt (`discord.moderation.*`, `roblox.*`, `*`).

### Auswertungsreihenfolge

| Schritt | Bedingung | Ergebnis |
| --- | --- | --- |
| 1 | Bot-Owner | erlaubt |
| 2 | ausdrueckliches DENY (Nutzer oder Rolle) | **verweigert** |
| 3 | Server-Owner | erlaubt |
| 4 | ausdrueckliches ALLOW | erlaubt |
| 5 | Discord-Administrator | erlaubt fuer Standardknoten |
| 6 | sonst | verweigert |

DENY steht bewusst vor allen ALLOW-Regeln: eine gesperrte Faehigkeit bleibt
gesperrt, auch fuer Administratoren. Entwicklerfunktionen
(`dashboard.developers.*`) sind von Schritt 5 ausgenommen — der Discord-Rang
allein berechtigt nicht zum Erstellen von API-Schluesseln.

### Bestaetigungspflichtige Aktionen

`discord.moderation.ban`, `discord.security.lockdown`, `discord.backup.restore`,
`roblox.moderation.ban`, `roblox.server.shutdown`.

Der Dialog nennt Ziel, Grund, Dauer und Auswirkung, laeuft nach 30 Sekunden ab
und akzeptiert nur den ausloesenden Nutzer.

## Umgang mit Geheimnissen

| Art | Speicherung | Begruendung |
| --- | --- | --- |
| API-Keys (`nxs_live_…`) | SHA-256-Hash + Praefix + letzte 4 Zeichen | Hoher Entropiegehalt; der Lookup muss schnell sein |
| Verifizierungscodes | scrypt | Geringe Entropie — ein schneller Hash waere angreifbar |
| Roblox-Signing-Secret | nur in der Umgebung, Hash in der Datenbank | Wird zum Signieren gebraucht, nie ausgeliefert |
| Dashboard-Sessions | signiertes, httpOnly-Cookie | Kein Discord-Token im Browser |

`redact()` entfernt Token, Passwoerter, Signaturen und Cookies aus jedem
Log-Kontext. Discord-Bot-Token werden zusaetzlich per Muster erkannt.

## Angriffsschutz

### AutoMod

Neun Regeln, jeweils mit eigener Aktion (`LOG_ONLY` … `BAN`), Schwellenwert und
Ausnahmen fuer Kanaele und Rollen. Zaehlbasierte Regeln nutzen Sliding Windows
in Redis und funktionieren dadurch ueber Shards hinweg. Ausgewertet wird lokal —
kein externer Aufruf pro Nachricht. Erkannt wird immer nur die schwerste
Verletzung, damit eine Nachricht nicht mehrfach bestraft wird.

Umgehungsversuche werden durch Normalisierung erschwert: Kleinschreibung,
Unicode-Zerlegung, Entfernen von Zero-Width-Zeichen, Leetspeak-Ruecksetzung,
Entfernen von Trennzeichen, Kollabieren von Wiederholungen.

### Anti-Nuke

Ueberwacht werden Massen-Bans, -Kicks, Kanal- und Rollenloeschungen,
Webhook-Erstellungen und Bot-Hinzufuegungen. Ueberschreitet ein Akteur den
Schwellenwert, entzieht NEXUS ihm alle entziehbaren Rollen, legt einen Vorfall
an und alarmiert mit Owner-Ping.

Grenzen, klar benannt:

- Der Verursacher ist nur mit der Berechtigung **Audit-Log einsehen** ermittelbar.
  Fehlt sie, wird alarmiert, aber nicht bestraft.
- Bereits ausgefuehrte Aktionen kann kein Bot rueckgaengig machen. Die
  Wiederherstellung erfolgt ueber `/backup restore`.
- Rollen oberhalb der Bot-Rolle sind unantastbar (Discord-Hierarchie).

### Notfallmodus

`/security lockdown` sichert je Kanal die bestehenden Rechte-Overwrites,
sperrt anschliessend `@everyone` und aktiviert den Join-Schutz. `/security unlock`
stellt exakt den gesicherten Zustand wieder her — nicht "alles erlauben".

## Roblox-Signaturprotokoll

```
canonical = METHOD \n PATH \n TIMESTAMP \n NONCE \n BODY
signature = HMAC-SHA256(secret, canonical)
```

Header: `x-nexus-key`, `x-nexus-signature`, `x-nexus-timestamp`,
`x-nexus-nonce`, `x-nexus-game`.

Serverseitige Pruefung:

1. Alle Header vorhanden
2. Universum bekannt und aktiv
3. Rate-Limit pro Spiel
4. Signatur korrekt (zeitkonstanter Vergleich)
5. Zeitabweichung ≤ `ROBLOX_REQUEST_SKEW_SECONDS`
6. Nonce im Fenster noch nicht verwendet

Der Rohkoerper geht unveraendert in die Signatur ein (kein Vor-Hash) — so
genuegt der Luau-Seite eine einzige kryptografische Primitive.

## Verifizierung

1. `/verify` erzeugt `NX-XXXXXX`; gespeichert werden scrypt-Hash und ein
   4-Zeichen-Hinweis fuer die indizierte Suche.
2. Der Spieler gibt den Code **im Spiel** ein.
3. Der Game-Server sendet Code + `Player.UserId` signiert an die API.
4. Die API prueft Hash, Ablauf und Versuchszaehler, verknuepft die Konten und
   veroeffentlicht `roblox.verified`; der Bot setzt Rollen und Nickname.

Eigenschaften: Codes sind einmalig, laufen nach 15 Minuten ab, haben ein
Versuchslimit von 5, und eine Roblox-ID kann nur zu einem Discord-Konto gehoeren.
Die Roblox-Identitaet stammt immer vom Game-Server, nie vom Client.

## Missbrauchsschutz der API

| Ebene | Grenze |
| --- | --- |
| HTTP pro IP oder Schluessel | `API_RATE_LIMIT_PER_MINUTE` (Standard 120/min) |
| Roblox pro Spiel | `ROBLOX_RATE_LIMIT_PER_MINUTE` (Standard 240/min) |
| Verifizierungsversuche | 5 pro 5 Minuten je Spieler und Spiel |
| Interaktionen pro Nutzer | 20 pro 10 Sekunden |
| Befehls-Cooldowns | je Befehl definiert |

## Meldung von Sicherheitsluecken

Bitte keine oeffentlichen Issues fuer Sicherheitsluecken. Melde sie privat an
die im Repository hinterlegte Kontaktadresse mit Beschreibung, Auswirkung und
Reproduktionsschritten.
