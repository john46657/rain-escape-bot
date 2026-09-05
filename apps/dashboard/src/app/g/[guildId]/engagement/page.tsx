import { Card, EmptyState } from '@/components/ui';
import { apiGet } from '@/lib/api';
import { formatNumber } from '@/lib/format';

interface Leaderboards {
  levels: Array<{ userId: string; level: number; totalXp: number; rank: number }>;
  economy: Array<{ userId: string; wallet: number; bank: number; rank: number }>;
}

export default async function EngagementPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const boards = await apiGet<Leaderboards>(`/api/v1/guilds/${guildId}/leaderboard`);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-100">Level & Wirtschaft</h1>
        <p className="mt-1 text-sm text-slate-500">
          Alle Betraege werden serverseitig und transaktional gebucht — Doppelbuchungen sind ausgeschlossen.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="XP-Bestenliste">
          {boards && boards.levels.length > 0 ? (
            <ol className="space-y-2">
              {boards.levels.map((entry) => (
                <li
                  key={entry.userId}
                  className="flex items-center gap-3 rounded-lg bg-base-850/50 px-3 py-2"
                >
                  <span className="w-6 text-center font-mono text-xs text-slate-500">{entry.rank}</span>
                  <span className="flex-1 truncate font-mono text-xs text-slate-300">{entry.userId}</span>
                  <span className="text-sm text-slate-200">Lv. {entry.level}</span>
                  <span className="w-24 text-right text-xs tabular-nums text-slate-500">
                    {formatNumber(entry.totalXp)} XP
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              title="Keine XP-Daten"
              description="Sobald Mitglieder schreiben, entsteht hier eine Rangliste."
            />
          )}
        </Card>

        <Card title="Vermoegensrangliste">
          {boards && boards.economy.length > 0 ? (
            <ol className="space-y-2">
              {boards.economy.map((entry) => (
                <li
                  key={entry.userId}
                  className="flex items-center gap-3 rounded-lg bg-base-850/50 px-3 py-2"
                >
                  <span className="w-6 text-center font-mono text-xs text-slate-500">{entry.rank}</span>
                  <span className="flex-1 truncate font-mono text-xs text-slate-300">{entry.userId}</span>
                  <span className="text-sm tabular-nums text-slate-200">
                    ⬢ {formatNumber(entry.wallet + entry.bank)}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              title="Keine Wirtschaftsdaten"
              description="Mit /daily, /work und dem Shop entstehen hier Werte."
            />
          )}
        </Card>
      </div>
    </div>
  );
}
