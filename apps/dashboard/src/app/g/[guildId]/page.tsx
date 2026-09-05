import Link from 'next/link';
import { AlertTriangle, ArrowUpRight, ShieldCheck, Ticket, Users } from 'lucide-react';
import { Card, StatCard, Badge } from '@/components/ui';
import { LiveFeed } from '@/components/live-feed';
import { apiGet } from '@/lib/api';
import { ACTION_STYLES, relativeTime } from '@/lib/format';

interface Overview {
  guild: { name: string; memberCount: number; premiumTier: string };
  config: { automodEnabled: boolean; antiNukeEnabled: boolean; lockdownActive: boolean; robloxEnabled: boolean };
  summary: Record<string, number>;
}

interface CaseEntry {
  caseId: string;
  action: string;
  targetId: string;
  moderatorId: string;
  reason: string;
  createdAt: string;
}

export default async function OverviewPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const [overview, cases] = await Promise.all([
    apiGet<Overview>(`/api/v1/guilds/${guildId}`),
    apiGet<CaseEntry[]>(`/api/v1/guilds/${guildId}/cases?pageSize=6`),
  ]);

  const summary = overview?.summary ?? {};

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Uebersicht</h1>
          <p className="mt-1 text-sm text-slate-500">
            {overview?.guild.name ?? 'Server'} · Tarif {overview?.guild.premiumTier ?? 'FREE'}
          </p>
        </div>
        <div className="flex gap-2">
          {overview?.config.lockdownActive ? (
            <Badge className="bg-danger/15 text-danger">🔒 Notfallmodus aktiv</Badge>
          ) : (
            <Badge className="bg-success/15 text-success">Betrieb normal</Badge>
          )}
          {overview?.config.robloxEnabled ? <Badge className="bg-roblox/15 text-roblox">Roblox verbunden</Badge> : null}
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Mitglieder" value={(summary['members'] ?? 0).toLocaleString('de-DE')} hint="laut Discord" />
        <StatCard label="Moderationsfaelle" value={summary['cases'] ?? 0} hint="gesamt" />
        <StatCard
          label="Offene Tickets"
          value={summary['openTickets'] ?? 0}
          tone={(summary['openTickets'] ?? 0) > 5 ? 'warning' : 'default'}
        />
        <StatCard
          label="Offene Vorfaelle"
          value={summary['openIncidents'] ?? 0}
          tone={(summary['openIncidents'] ?? 0) > 0 ? 'danger' : 'success'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          title="Letzte Moderationsfaelle"
          className="lg:col-span-2"
          action={
            <Link href={`/g/${guildId}/moderation`} className="flex items-center gap-1 text-xs text-accent-soft hover:underline">
              Alle ansehen <ArrowUpRight className="h-3 w-3" />
            </Link>
          }
        >
          {cases && cases.length > 0 ? (
            <ul className="space-y-3">
              {cases.map((entry) => (
                <li key={entry.caseId} className="flex items-start gap-3">
                  <Badge className={ACTION_STYLES[entry.action] ?? 'bg-base-700 text-slate-300'}>{entry.action}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-300">{entry.reason}</p>
                    <p className="text-xs text-slate-600">
                      <code className="font-mono">{entry.caseId}</code> · Ziel {entry.targetId} ·{' '}
                      {relativeTime(entry.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-sm text-slate-600">Noch keine Faelle — ein gutes Zeichen.</p>
          )}
        </Card>

        <Card title="Live-Ereignisse">
          <LiveFeed guildId={guildId} />
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card title="Schutzstatus">
          <ul className="space-y-2 text-sm">
            <li className="flex items-center justify-between">
              <span className="text-slate-400">AutoMod</span>
              <Badge className={overview?.config.automodEnabled ? 'bg-success/15 text-success' : 'bg-base-700 text-slate-400'}>
                {overview?.config.automodEnabled ? 'aktiv' : 'aus'}
              </Badge>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-slate-400">Anti-Nuke</span>
              <Badge className={overview?.config.antiNukeEnabled ? 'bg-success/15 text-success' : 'bg-base-700 text-slate-400'}>
                {overview?.config.antiNukeEnabled ? 'aktiv' : 'aus'}
              </Badge>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-slate-400">Verifizierte Mitglieder</span>
              <span className="tabular-nums text-slate-300">{summary['verifiedMembers'] ?? 0}</span>
            </li>
          </ul>
        </Card>

        <Card title="Schnellzugriff">
          <div className="space-y-2 text-sm">
            <Link href={`/g/${guildId}/security`} className="nav-link">
              <ShieldCheck className="h-4 w-4" /> Sicherheitszentrale
            </Link>
            <Link href={`/g/${guildId}/tickets`} className="nav-link">
              <Ticket className="h-4 w-4" /> Tickets bearbeiten
            </Link>
            <Link href={`/g/${guildId}/engagement`} className="nav-link">
              <Users className="h-4 w-4" /> Ranglisten ansehen
            </Link>
          </div>
        </Card>

        <Card title="Roblox">
          <p className="text-3xl font-semibold tabular-nums text-slate-100">{summary['robloxServers'] ?? 0}</p>
          <p className="mt-1 text-xs text-slate-500">Serverinstanzen online</p>
          <Link href={`/g/${guildId}/roblox`} className="mt-4 inline-flex items-center gap-1 text-xs text-accent-soft hover:underline">
            Spiele verwalten <ArrowUpRight className="h-3 w-3" />
          </Link>
          {(summary['openIncidents'] ?? 0) > 0 ? (
            <p className="mt-4 flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
              <AlertTriangle className="h-3.5 w-3.5" /> Sicherheitsvorfaelle warten auf Bearbeitung.
            </p>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
