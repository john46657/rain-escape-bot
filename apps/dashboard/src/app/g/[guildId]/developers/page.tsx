import { KeyRound, ShieldAlert } from 'lucide-react';
import { Badge, Card, EmptyState, Table } from '@/components/ui';
import { apiGet } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  scopes: string[];
  environment: string;
  usageCount: number;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export default async function DevelopersPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const keys = await apiGet<ApiKey[]>(`/api/v1/guilds/${guildId}/keys`);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-100">Entwicklerportal</h1>
        <p className="mt-1 text-sm text-slate-500">
          API-Keys fuer eigene Integrationen. Der Schluessel wird nur bei der Erstellung angezeigt.
        </p>
      </header>

      <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <p className="text-xs text-warning/90">
          NEXUS speichert ausschliesslich den SHA-256-Hash eines Schluessels. Ein verlorener Schluessel kann nicht
          wiederhergestellt, sondern nur widerrufen und neu erstellt werden.
        </p>
      </div>

      <Card title={`API-Keys (${keys?.length ?? 0})`}>
        {keys && keys.length > 0 ? (
          <Table head={['Name', 'Schluessel', 'Umgebung', 'Scopes', 'Nutzung', 'Zuletzt', 'Status']}>
            {keys.map((key) => (
              <tr key={key.id} className="transition hover:bg-base-850/60">
                <td className="table-cell text-slate-200">{key.name}</td>
                <td className="table-cell font-mono text-xs text-slate-500">
                  {key.prefix}…{key.last4}
                </td>
                <td className="table-cell">
                  <Badge className={key.environment === 'live' ? 'bg-accent/15 text-accent-soft' : 'bg-base-700 text-slate-400'}>
                    {key.environment}
                  </Badge>
                </td>
                <td className="table-cell text-xs text-slate-500">{key.scopes.join(', ')}</td>
                <td className="table-cell tabular-nums text-slate-400">{key.usageCount}</td>
                <td className="table-cell text-xs text-slate-500">{formatDate(key.lastUsedAt)}</td>
                <td className="table-cell">
                  {key.revokedAt ? (
                    <Badge className="bg-danger/15 text-danger">widerrufen</Badge>
                  ) : (
                    <Badge className="bg-success/15 text-success">aktiv</Badge>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState
            title="Noch kein API-Key"
            description="Erstelle einen Schluessel ueber POST /api/v1/guilds/<id>/keys mit Name und Scopes."
          />
        )}
      </Card>

      <Card title="Schnellstart">
        <pre className="overflow-x-auto rounded-lg bg-base-950 p-4 font-mono text-xs leading-relaxed text-slate-400">
{`# Schluessel erstellen (Antwort enthaelt den Klartext genau einmal)
curl -X POST "$NEXUS_API/api/v1/guilds/${guildId}/keys" \\
  -H 'content-type: application/json' \\
  -d '{"name":"Meine Integration","scopes":["guilds:read","moderation:read"]}'

# Daten abrufen
curl "$NEXUS_API/api/v1/guilds/${guildId}/cases" \\
  -H "authorization: Bearer nxs_live_..."`}
        </pre>
        <p className="mt-3 flex items-center gap-2 text-xs text-slate-600">
          <KeyRound className="h-3.5 w-3.5" /> Vollstaendige Referenz: docs/API.md
        </p>
      </Card>
    </div>
  );
}
