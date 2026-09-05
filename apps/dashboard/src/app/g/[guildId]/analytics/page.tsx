import { Card, StatCard } from '@/components/ui';
import { TrendChart, type TrendPoint } from '@/components/trend-chart';
import { apiGet } from '@/lib/api';

interface AnalyticsPayload {
  summary: Record<string, number>;
  series: TrendPoint[];
}

export default async function AnalyticsPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const analytics = await apiGet<AnalyticsPayload>(`/api/v1/guilds/${guildId}/analytics`);
  const series = analytics?.series ?? [];
  const summary = analytics?.summary ?? {};

  const first = series[0]?.metrics['members'] ?? 0;
  const last = series[series.length - 1]?.metrics['members'] ?? 0;
  const growth = first > 0 ? ((last - first) / first) * 100 : 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-100">Analytics</h1>
        <p className="mt-1 text-sm text-slate-500">Taegliche Momentaufnahmen der letzten 30 Tage.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Mitglieder" value={(summary['members'] ?? 0).toLocaleString('de-DE')} />
        <StatCard
          label="Wachstum (30 T.)"
          value={`${growth >= 0 ? '+' : ''}${growth.toFixed(1)} %`}
          tone={growth >= 0 ? 'success' : 'danger'}
        />
        <StatCard label="Verifiziert" value={summary['verifiedMembers'] ?? 0} />
        <StatCard label="Roblox-Server" value={summary['robloxServers'] ?? 0} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Mitgliederentwicklung">
          <TrendChart series={series} metric="members" label="Mitglieder" />
        </Card>
        <Card title="Nachrichten pro Tag">
          <TrendChart series={series} metric="messages" label="Nachrichten" />
        </Card>
        <Card title="Moderationsfaelle">
          <TrendChart series={series} metric="cases" label="Faelle" />
        </Card>
        <Card title="Roblox-Spieler">
          <TrendChart series={series} metric="robloxPlayers" label="Spieler" />
        </Card>
      </div>
    </div>
  );
}
