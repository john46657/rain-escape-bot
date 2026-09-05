# NEXUS Luau-SDK

Server-seitiges SDK fuer Roblox-Erlebnisse.

## Dateien

| Datei              | Zweck                                                         |
| ------------------ | ------------------------------------------------------------- |
| `NexusCrypto.luau` | SHA-256 und HMAC-SHA256 in reinem Luau (inkl. Selbsttest)     |
| `NexusClient.luau` | Signierte HTTP-Aufrufe mit Retry, Backoff und Circuit Breaker |
| `NexusServer.luau` | Laufzeit: Heartbeat, Ereignisse, Kommandos, Verifizierung     |

## Einbau

1. Ordner als ModuleScript-Baum nach `ServerScriptService/Nexus` kopieren.
2. Signing-Secret in **ServerStorage** ablegen (nie in ReplicatedStorage).
3. In einem Server-Script:

```lua
local NexusServer = require(game:GetService("ServerScriptService").Nexus.NexusServer)

NexusServer.start({
    baseUrl = "https://nexus.example.com",
    apiKey = "nxs_live_…",
    signingSecret = game:GetService("ServerStorage").NexusConfig.SigningSecret.Value,
    universeId = tostring(game.GameId),
})
```

## Sicherheitsregeln

- Alle Module laufen ausschliesslich auf dem Server. `NexusClient.new`
  bricht ab, wenn es in einem LocalScript ausgefuehrt wird.
- Spieleridentitaeten stammen immer aus `Player`-Objekten des Servers,
  niemals aus Client-Nachrichten.
- Das Secret darf weder repliziert noch geloggt werden.

## Kompatibilitaet

Die Signatur entspricht bitgenau `packages/security/src/signing.ts`:

```
METHOD \n PATH \n TIMESTAMP \n NONCE \n BODY
```

`NexusCrypto.selfTest()` prueft beim Start gegen FIPS 180-4 (SHA-256) und
RFC 4231 (HMAC) und verhindert einen Betrieb mit fehlerhafter Kryptografie.

Ausfuehrliche Anleitung: `docs/ROBLOX.md`.
