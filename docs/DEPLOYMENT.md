# Betrieb

## Mit Docker (empfohlen)

```bash
cp .env.example .env       # Werte eintragen, insbesondere alle CHANGE_ME
cd docker
docker compose up -d --build
docker compose ps          # alle Dienste "healthy"?
docker compose logs -f bot
```

Startreihenfolge: Postgres und Redis werden abgewartet, danach laufen die
Migrationen, erst dann starten API, Bot und Dashboard.

### Aktualisieren

```bash
git pull
cd docker
docker compose up -d --build
```

Migrationen laufen automatisch im `migrate`-Dienst.

## Ohne Docker

```bash
npm ci
npm run db:generate
npm run db:migrate:deploy
npm run build              # dist/bot.mjs und dist/api.mjs
node dist/api.mjs &
node dist/bot.mjs &
npm run start --workspace @nexus/dashboard
```

Fuer den Dauerbetrieb empfiehlt sich ein Prozessmanager (systemd, PM2) mit
Neustart bei Fehlern.

## Sharding

Ab etwa 2.000 Servern schreibt Discord Sharding vor:

```bash
node --import tsx apps/bot/src/sharding.ts
```

`DISCORD_SHARD_COUNT` leer lassen fuer die automatische Empfehlung von Discord.
Der Manager startet abgestuerzte Shards neu. Alle geteilten Zustaende liegen in
Redis, daher benoetigen Shards keine direkte Kommunikation.

## Reverse Proxy

```nginx
server {
    listen 443 ssl http2;
    server_name nexus.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket fuer Live-Aktualisierungen
    location /api/v1/realtime {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Wichtig: Der Roblox-Endpunkt darf den Anfragekoerper **nicht** veraendern —
keine Umformatierung, keine Kompression auf dem Weg zur API. Andernfalls
schlaegt die Signaturpruefung fehl.

## Sicherung

```bash
# Datenbank
docker compose exec postgres pg_dump -U nexus nexus | gzip > nexus-$(date +%F).sql.gz

# Wiederherstellung
gunzip -c nexus-2026-01-01.sql.gz | docker compose exec -T postgres psql -U nexus nexus
```

Redis enthaelt ausschliesslich Cache- und Koordinationsdaten und muss nicht
gesichert werden.

## Ueberwachung

| Pruefung | Aufruf | Erwartung |
| --- | --- | --- |
| API lebt | `GET /health/live` | 200 |
| API bereit | `GET /health/ready` | 200 und `status: ok` |
| Bot laeuft | Container-Healthcheck | Prozess vorhanden |

Beobachtenswerte Logzeilen: `level=error`, `msg="Job fehlgeschlagen"`,
`msg="Anti-Nuke ausgeloest"`, `msg="Roblox-Anfrage abgelehnt"`.

## Haeufige Probleme

| Symptom | Ursache | Loesung |
| --- | --- | --- |
| Befehle erscheinen nicht | Nicht registriert oder globale Verteilung laeuft noch | `npm run deploy:commands`, fuer Tests `DISCORD_DEV_GUILD_ID` setzen |
| „Used disallowed intents“ | Privileged Intents nicht aktiviert | Developer Portal → Bot → Intents |
| Dashboard zeigt keine Daten | API nicht erreichbar | `API_INTERNAL_URL` pruefen, `/health/ready` aufrufen |
| Roblox: `signature_invalid` | Secret oder Pfad falsch, Proxy veraendert den Koerper | siehe `docs/ROBLOX.md` |
| Bot startet nicht | Pflichtvariablen fehlen | Fehlermeldung nennt das Feld; `.env.example` vergleichen |
