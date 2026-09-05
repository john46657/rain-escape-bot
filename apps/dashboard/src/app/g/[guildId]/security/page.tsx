import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { Badge, Card, EmptyState, StatCard } from '@/components/ui';
import { apiGet } from '@/lib/api';
import { SEVERITY_STYLES, formatDate } from '@/lib/format';

interface Incident {
  id: string;
  kind: string;
  severity: string;
  status: string;
  title: string;
  description: string;
  actorId: string | null;
  actionsTaken: string[];
  createdAt: string;
}

interface Overview {
  config: {
    automodEnabled: boolean;
    antiNukeEnabled: boolean;
    raidModeEnabled: boolean;
    lockdownActive: boolean;
    minAccountAgeDays: number;
    automodConfig: Record<string, { enabled: boolean; action: string; threshold: number } | undefined>;
  };
}

export default async function SecurityPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const [incidents, overview] = await Promise.all([
    apiGet<Incident[]>(`/api/v1/guilds/${guildId}/incidents?pageSize=25`),
    apiGet<Overview>(`/api/v1/guilds/${guildId}`),
  ]);

  const open = (incidents ?? []).filter((incident) => incident.status === 'OPEN');
  const rules = Object.entries(overview?.config.automodConfig ?? {}).filter(([, rule]) => rule?.enabled);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-100">Sicherheitszentrale</h1>
        <p className="mt-1 text-sm text-slate-500">
          AutoMod, Anti-Nuke und Notfallmodus. Kritische Aktionen erfordern eine ausdrueckliche Bestaetigung
          im Bot.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard
          label="Offene Vorfaelle"
          value={open.length}
          tone={open.length > 0 ? 'danger' : 'success'}
        />
        <StatCard label="AutoMod-Regeln" value={rules.length} hint="aktiv" />
        <StatCard
          label="Anti-Nuke"
          value={overview?.config.antiNukeEnabled ? 'An' : 'Aus'}
          tone={overview?.config.antiNukeEnabled ? 'success' : 'warning'}
        />
        <StatCard
          label="Notfallmodus"
          value={overview?.config.lockdownActive ? 'Aktiv' : 'Inaktiv'}
          tone={overview?.config.lockdownActive ? 'danger' : 'default'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Vorfaelle" className="lg:col-span-2">
          {incidents && incidents.length > 0 ? (
            <ul className="space-y-3">
              {incidents.map((incident) => (
                <li key={incident.id} className="rounded-lg border border-base-800 bg-base-850/50 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={SEVERITY_STYLES[incident.severity] ?? ''}>{incident.severity}</Badge>
                    <Badge>{incident.kind}</Badge>
                    <span className="text-sm font-medium text-slate-200">{incident.title}</span>
                    <span className="ml-auto text-xs text-slate-600">{formatDate(incident.createdAt)}</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-400">{incident.description}</p>
                  {incident.actionsTaken.length > 0 ? (
                    <p className="mt-2 flex flex-wrap gap-2">
                      {incident.actionsTaken.map((action) => (
                        <Badge key={action} className="bg-accent/10 text-accent-soft">
                          <ShieldCheck className="h-3 w-3" /> {action}
                        </Badge>
                      ))}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-slate-600">
                    Status: {incident.status}
                    {incident.actorId ? ` · Akteur ${incident.actorId}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="Keine Vorfaelle"
              description="NEXUS meldet hier automatisch Raids, Nuke-Versuche und AutoMod-Treffer."
            />
          )}
        </Card>

        <Card title="AutoMod-Regeln">
          {rules.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {rules.map(([name, rule]) => (
                <li
                  key={name}
                  className="flex items-center justify-between gap-2 rounded-lg bg-base-850/50 px-3 py-2"
                >
                  <span className="font-mono text-xs text-slate-300">{name}</span>
                  <Badge className="bg-accent/10 text-accent-soft">{rule?.action}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">Keine Regeln aktiv.</p>
          )}
          <p className="mt-4 flex gap-2 rounded-lg bg-warning/10 p-3 text-xs text-warning">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Discord erlaubt kein Rueckgaengigmachen bereits ausgefuehrter Aktionen. NEXUS entmachtet
            Angreifer, sperrt den Server und alarmiert — eine Wiederherstellung erfolgt ueber Backups.
          </p>
        </Card>
      </div>
    </div>
  );
}
