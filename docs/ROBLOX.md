# Roblox-Integration

## Voraussetzungen

1. **HTTP-Anfragen aktivieren**: Roblox Studio → *Game Settings* → *Security* →
   *Allow HTTP Requests*. Ohne diese Einstellung kann das Spiel NEXUS nicht erreichen.
2. **Erreichbare API**: `API_PUBLIC_URL` muss aus dem Internet aufrufbar sein
   (HTTPS). Fuer lokale Tests eignet sich ein Tunnel.
3. **Universe-ID**: zu finden unter [create.roblox.com](https://create.roblox.com)
   in den Einstellungen der Erfahrung.
4. *(optional)* **Open-Cloud-API-Key** mit der Berechtigung
   `universe-messaging-service:publish` — beschleunigt Kommandos von ~5 Sekunden
   Polling auf nahezu sofort. Ohne Key funktioniert alles ueber Polling.

## Spiel verbinden

1. Im Dashboard unter **Roblox → Spiel hinzufuegen** die Universe-ID eintragen.
   NEXUS zeigt das Signing-Secret **genau einmal** an.
2. Secret in Roblox Studio ablegen — in **ServerStorage**, niemals in
   ReplicatedStorage:

   ```
   ServerStorage/
     └── NexusConfig (Folder)
           └── SigningSecret (StringValue)
   ```

3. Den Ordner `packages/roblox-sdk/luau` als ModuleScript-Baum nach
   `ServerScriptService/Nexus` kopieren.
4. Startskript (Server-Script) anlegen:

   ```lua
   local ServerScriptService = game:GetService("ServerScriptService")
   local ServerStorage = game:GetService("ServerStorage")

   local NexusServer = require(ServerScriptService.Nexus.NexusServer)

   NexusServer.start({
       baseUrl = "https://nexus.deine-domain.tld",
       apiKey = "nxs_live_…",
       signingSecret = ServerStorage.NexusConfig.SigningSecret.Value,
       universeId = tostring(game.GameId),
       debug = false,
   })
   ```

Beim Start prueft das SDK die eigene Kryptografie gegen die offiziellen
Testvektoren und bricht bei Abweichung ab — ein stiller Fehler waere gefaehrlicher
als ein lauter.

## Was das SDK tut

| Aufgabe | Intervall | Endpunkt |
| --- | --- | --- |
| Handshake und Zeitabgleich | beim Start | `POST /api/v1/roblox/handshake` |
| Heartbeat (Spieler, FPS, Speicher) | 30 s | `POST /api/v1/roblox/heartbeat` |
| Ereignisse (gebuendelt, max. 50) | 5 s | `POST /api/v1/roblox/events` |
| Kommandos abholen | 5 s | `POST /api/v1/roblox/commands` |
| Kommando bestaetigen | sofort | `POST /api/v1/roblox/commands/ack` |

Der Zeitabgleich aus dem Handshake verhindert Ablehnungen wegen `clock_skew`,
falls die Uhr der Roblox-Instanz abweicht.

## Ereignisse senden

```lua
NexusServer.pushEvent("QUEST_COMPLETED", { questId = "tutorial", reward = 100 }, player)
```

Jedes Ereignis erhaelt eine GUID. Schlaegt die Uebertragung fehl, wandert der
Stapel zurueck in die Warteschlange; die Server-Seite erkennt Doppelungen
anhand der `eventId` und verarbeitet sie genau einmal.

## Kommandos empfangen

Vier Kommandos sind vorbelegt: `ANNOUNCE`, `KICK_PLAYER`, `BAN_PLAYER`, `SHUTDOWN`.
Eigene lassen sich registrieren:

```lua
NexusServer.onCommand("GIVE_ITEM", function(payload)
    local player = game.Players:GetPlayerByUserId(tonumber(payload.robloxUserId))
    if not player then
        return false, "Spieler nicht auf diesem Server"
    end
    -- eigene Logik …
    return true, "Item vergeben"
end)
```

Der Rueckgabewert wird als Bestaetigung an NEXUS gemeldet und erscheint im
Dashboard.

## Verifizierung einbauen

Der Spieler erhaelt seinen Code ueber `/verify` in Discord und gibt ihn im Spiel
ein. Die Einloesung gehoert zwingend auf den Server:

```lua
local remote = Instance.new("RemoteFunction")
remote.Name = "NexusVerify"
remote.Parent = game:GetService("ReplicatedStorage")

remote.OnServerInvoke = function(player, code)
    -- `player` stammt vom Server, nicht aus der Client-Nachricht.
    if typeof(code) ~= "string" then
        return false, "Ungueltige Eingabe"
    end
    return NexusServer.verifyPlayer(player, code)
end
```

Ein LocalScript darf ausschliesslich den eingegebenen Text senden — niemals eine
Nutzer-ID. Andernfalls koennte ein manipulierter Client fremde Konten verknuepfen.

## Belohnungen ueber Plattformgrenzen

```lua
local ok, message = NexusServer.claimReward(player, "weekly-quest")
```

Der Aufruf ist idempotent: der Standard-Idempotenzschluessel besteht aus
Nutzer-ID und Belohnungsschluessel. Wiederholte Aufrufe melden „bereits
erhalten“, statt erneut gutzuschreiben.

## Gruppen-Synchronisation

Im Dashboard werden Roblox-Rang → Discord-Rolle-Zuordnungen hinterlegt. NEXUS
synchronisiert alle 30 Minuten sowie bei jeder Verifizierung. Veraendert werden
ausschliesslich Rollen, die in der Zuordnung stehen — alle anderen bleiben
unberuehrt.

## Fehlersuche

| Symptom | Ursache | Loesung |
| --- | --- | --- |
| `signature_invalid` | Secret stimmt nicht oder Pfad weicht ab | Secret pruefen; `baseUrl` ohne abschliessenden Schraegstrich |
| `clock_skew` | Zeitabweichung > 300 s | Handshake muss erfolgreich sein; ggf. Fenster erhoehen |
| `replay_detected` | Nonce doppelt verwendet | Tritt nur bei manipuliertem SDK auf |
| `unknown_game` | Universe-ID nicht hinterlegt oder Spiel inaktiv | Dashboard pruefen |
| `rate_limited` | zu viele Anfragen | Intervalle beibehalten, Ereignisse buendeln |
| Keine HTTP-Verbindung | HTTP-Anfragen deaktiviert | Game Settings → Security |
