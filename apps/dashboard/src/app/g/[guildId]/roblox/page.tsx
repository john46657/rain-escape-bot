import { Gamepad2, Server } from 'lucide-react';
import { Badge, Card, EmptyState, StatCard } from '@/components/ui';
import { apiGet } from '@/lib/api';
import { relativeTime } from '@/lib/format';

interface RobloxGame {
  id: string;
  name: string;
  universeId: string;
  active: boolean;
  lastEventAt: string | null;
  secretHint: string;
  servers: Array<{
    jobId: string;
    playerCount: number;
    maxPlayers: number;
    fps: number | null;
    status: string;
    lastHeartbeatAt: string;
  }>;
}

export default async function RobloxPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const games = await apiGet<RobloxGame[]>(`/api/v1/guilds/${guildId}/roblox`);

  const online = (games ?? []).flatMap((game) => game.servers.filter((server) => server.status === 'online'));
  const players = online.reduce((sum, server) => sum + server.playerCount, 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-100">Roblox</h1>
        <p className="mt-1 text-sm text-slate-500">
          Verbundene Universen, laufende Serverinstanzen und der Zustand der signierten Verbindung.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Verbundene Spiele" value={games?.length ?? 0} />
        <StatCard label="Instanzen online" value={online.length} tone={online.length > 0 ? 'success' : 'default'} />
        <StatCard label="Spieler aktuell" value={players} />
      </div>

      {games && games.length > 0 ? (
        <div className="space-y-4">
          {games.map((game) => (
            <Card
              key={game.id}
              title={game.name}
              action={
                <div className="flex items-center gap-2">
                  <Badge className={game.active ? 'bg-success/15 text-success' : 'bg-base-700 text-slate-400'}>
                    {game.active ? 'aktiv' : 'inaktiv'}
                  </Badge>
                  <span className="font-mono text-xs text-slate-600">Universe {game.universeId}</span>
                </div>
              }
            >
              <div className="mb-4 flex flex-wrap gap-4 text-xs text-slate-500">
                <span>
                  Signing-Secret: <code className="rounded bg-base-800 px-1.5 py-0.5 font-mono">{game.secretHint}…</code>{' '}
                  (nur Hash gespeichert)
                </span>
                <span>Letztes Event: {relativeTime(game.lastEventAt)}</span>
              </div>

              {game.servers.length > 0 ? (
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {game.servers.map((server) => (
                    <li key={server.jobId} className="rounded-lg border border-base-800 bg-base-850/50 p-4">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 font-mono text-xs text-slate-400">
                          <Server className="h-3.5 w-3.5" />
                          {server.jobId.slice(0, 14)}
                        </span>
                        <Badge className={server.status === 'online' ? 'bg-success/15 text-success' : 'bg-base-700 text-slate-400'}>
                          {server.status}
                        </Badge>
                      </div>
                      <p className="mt-3 text-2xl font-semibold tabular-nums text-slate-100">
                        {server.playerCount}
                        <span className="text-sm text-slate-600"> / {server.maxPlayers}</span>
                      </p>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-base-800">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${Math.min(100, (server.playerCount / Math.max(1, server.maxPlayers)) * 100)}%` }}
                        />
                      </div>
                      <p className="mt-2 text-xs text-slate-600">
                        {server.fps ? `${Math.round(server.fps)} FPS · ` : ''}
                        Heartbeat {relativeTime(server.lastHeartbeatAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">Aktuell keine Instanz online.</p>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          title="Kein Spiel verbunden"
          description="Fuege ein Universum hinzu und binde das Luau-SDK ein. Das Signing-Secret wird genau einmal angezeigt."
        />
      )}

      <Card title="So verbindest du ein Spiel">
        <ol className="space-y-2 text-sm text-slate-400">
          <li className="flex gap-3">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-base-800 text-[11px]">1</span>
            Universe-ID im Dashboard hinterlegen — NEXUS erzeugt ein Signing-Secret (nur einmal sichtbar).
          </li>
          <li className="flex gap-3">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-base-800 text-[11px]">2</span>
            <span>
              <code className="rounded bg-base-800 px-1.5 py-0.5 font-mono text-xs">packages/roblox-sdk/luau</code> in
              ServerScriptService einbinden und Secret in einem ServerStorage-Wert ablegen.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-base-800 text-[11px]">3</span>
            HTTP-Requests in den Spieleinstellungen aktivieren — danach erscheinen Heartbeats hier automatisch.
          </li>
        </ol>
        <p className="mt-4 flex items-center gap-2 text-xs text-slate-600">
          <Gamepad2 className="h-3.5 w-3.5" /> Details: docs/ROBLOX.md
        </p>
      </Card>
    </div>
  );
}
