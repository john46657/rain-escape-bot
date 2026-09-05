# Module

Jedes Modul liegt unter `modules/<name>` und exportiert ein `NexusModule`.
Die Spalte _Reife_ unterscheidet vollstaendig ausgearbeitete Module von
Geruesten, die einen externen Dienst benoetigen.

| Modul      | Reife                                    | Befehle                                                                                                                                                             |
| ---------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| moderation | vollstaendig                             | `/ban` `/unban` `/kick` `/softban` `/timeout` `/untimeout` `/warn` `/warnings` `/clear` `/slowmode` `/lock` `/unlock` `/nick` `/role` `/note` `/modhistory` `/case` |
| security   | vollstaendig                             | `/security lockdown\|unlock\|incidents\|resolve\|status\|whitelist`                                                                                                 |
| tickets    | vollstaendig                             | `/ticket open\|close\|add\|panel\|list`                                                                                                                             |
| community  | vollstaendig                             | `/suggest` `/poll` `/afk`                                                                                                                                           |
| levels     | vollstaendig                             | `/rank` `/leaderboard` `/xp add\|remove\|setlevel`                                                                                                                  |
| economy    | vollstaendig                             | `/balance` `/daily` `/work` `/pay` `/deposit` `/withdraw` `/shop` `/inventory` `/richest` `/eco`                                                                    |
| roblox     | vollstaendig                             | `/verify` `/unlink` `/roblox profile\|lookup\|servers\|announce\|kick\|ban\|shutdown\|groupsync` `/robloxgame`                                                      |
| games      | vollstaendig                             | `/coinflip` `/dice` `/slots` `/rps` `/8ball`                                                                                                                        |
| giveaways  | vollstaendig                             | `/giveaway create\|end\|reroll\|list`                                                                                                                               |
| backup     | vollstaendig                             | `/backup create\|list\|restore\|delete`                                                                                                                             |
| analytics  | vollstaendig                             | `/analytics`                                                                                                                                                        |
| automation | Engine vollstaendig, Regeln im Dashboard | `/automation list\|toggle`                                                                                                                                          |
| ai         | optional (API-Key noetig)                | `/ask`                                                                                                                                                              |
| music      | Geruest (Lavalink noetig)                | `/music play\|skip\|stop\|queue\|status`                                                                                                                            |

## Moderation

Alle Aktionen laufen durch `ModerationService.execute`:
Hierarchiepruefung → Discord-Aktion → Fall speichern → DM → Mod-Log → Audit →
Ereignis. Der Fall entsteht erst **nach** der erfolgreichen Discord-Aktion, damit
die Historie keine nie ausgefuehrten Massnahmen enthaelt.

Befristete Massnahmen (Tempban, ablaufende Verwarnungen) hebt ein Scheduler-Job
im Minutentakt auf.

## Security

Drei Bausteine:

- `automod.ts` — neun Regeln, lokale Auswertung, Redis-Sliding-Windows
- `antinuke.ts` — Schwellenwerte je Aktion, Entmachtung, Vorfall, Alarm
- `lockdown.ts` — Snapshot der Kanalrechte, exakte Wiederherstellung

Fuehrt AutoMod eine Massnahme aus, laeuft sie ueber denselben
`ModerationService` — sie taucht also mit Quelle `AUTOMOD` in der Fallhistorie auf.

## Tickets

Panel → Auswahlmenue → Modal → privater Kanal mit Claim- und Close-Button.
Beim Schliessen werden die Nachrichten gesichert, ein Transkript erzeugt und in
den Log-Kanal gelegt; der Kanal wird fuenf Sekunden spaeter geloescht.
Grenze: drei offene Tickets je Nutzer.

## Wirtschaft

Kritischster Bereich. Jede Buchung geht durch `store.economy.mutate` bzw.
`transfer`:

- Idempotenzschluessel verhindern Doppelbuchungen bei Retries oder Doppelklicks.
- Bedingte Updates verhindern negative Salden und verlorene Aktualisierungen.
- Jede Bewegung erzeugt eine Transaktionszeile mit Saldo danach.

Belohnungen aus Roblox laufen zusaetzlich ueber `RewardGrant` mit eigenem
Idempotenzschluessel — zwei unabhaengige Sicherungen gegen doppelte Gutschriften.

## Automation

Regel = Trigger + Bedingungen + Aktionen.

```jsonc
{
  "trigger": "member.join",
  "conditions": [{ "field": "accountAgeDays", "operator": "lt", "value": 7 }],
  "actions": [
    { "type": "discord.role.add", "params": { "roleId": "…" } },
    { "type": "notification.send", "params": { "title": "Junges Konto" } },
  ],
}
```

Schutz vor Schleifen: Rate-Limit je Regel und Stunde; wird es ueberschritten,
deaktiviert sich die Regel selbst und der Vorfall wird protokolliert.

## Musik (Geruest)

Discord-Bots koennen Audio nur ueber einen Voice-Gateway-Stream ausgeben. Eine
produktionsreife Wiedergabe benoetigt einen Audio-Knoten wie Lavalink. Ohne
`LAVALINK_HOST` meldet das Modul offen, dass es nicht konfiguriert ist, statt
eine Funktion vorzutaeuschen.

Zum Aktivieren: Lavalink betreiben, Zugangsdaten in `.env` setzen,
Client-Bibliothek einbinden und den Erweiterungspunkt `MusicPlayer` ausfuellen.

## KI (optional)

Spricht eine OpenAI-kompatible Chat-Completions-API an (OpenAI, Azure OpenAI
oder ein lokaler Server mit kompatibler Route). Uebertragen werden nur der
Prompt und die Sprache — keine Nachrichtenhistorie, keine Nutzer-IDs.

## Eigenes Modul anlegen

```
modules/mein-modul/
├── package.json      # name: @nexus/module-mein-modul
├── tsconfig.json
└── src/index.ts      # export default { name, description, commands, … }
```

Anschliessend in `apps/bot/src/modules.ts` importieren und in `loadModules()`
eintragen. Die Registry meldet doppelte Befehlsnamen beim Start.
