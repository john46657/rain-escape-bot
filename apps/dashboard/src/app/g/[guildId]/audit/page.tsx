import { Badge, Card, EmptyState, Table } from '@/components/ui';
import { apiGet } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface AuditEntry {
  id: string;
  actorId: string;
  actorType: string;
  action: string;
  targetId: string | null;
  targetType: string | null;
  result: string;
  reason: string | null;
  createdAt: string;
}

const RESULT_STYLES: Record<string, string> = {
  SUCCESS: 'bg-success/15 text-success',
  DENIED: 'bg-danger/15 text-danger',
  FAILED: 'bg-warning/15 text-warning',
};

export default async function AuditPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const entries = await apiGet<AuditEntry[]>(`/api/v1/guilds/${guildId}/audit?pageSize=50`);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-100">Audit-Log</h1>
        <p className="mt-1 text-sm text-slate-500">
          Wer hat was wann getan — inklusive Aktionen aus Dashboard, API und Roblox. Eintraege sind
          unveraenderlich.
        </p>
      </header>

      <Card title={`Eintraege (${entries?.length ?? 0})`}>
        {entries && entries.length > 0 ? (
          <Table head={['Zeitpunkt', 'Aktion', 'Akteur', 'Quelle', 'Ziel', 'Ergebnis', 'Grund']}>
            {entries.map((entry) => (
              <tr key={entry.id} className="transition hover:bg-base-850/60">
                <td className="table-cell text-xs text-slate-500">{formatDate(entry.createdAt)}</td>
                <td className="table-cell font-mono text-xs text-slate-300">{entry.action}</td>
                <td className="table-cell font-mono text-xs text-slate-500">{entry.actorId}</td>
                <td className="table-cell">
                  <Badge>{entry.actorType}</Badge>
                </td>
                <td className="table-cell font-mono text-xs text-slate-500">
                  {entry.targetId ? `${entry.targetType ?? ''} ${entry.targetId}` : '—'}
                </td>
                <td className="table-cell">
                  <Badge className={RESULT_STYLES[entry.result] ?? ''}>{entry.result}</Badge>
                </td>
                <td className="table-cell max-w-xs truncate text-xs text-slate-500">{entry.reason ?? '—'}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState
            title="Kein Audit-Eintrag"
            description="Sicherheitsrelevante Aktionen werden hier revisionssicher protokolliert."
          />
        )}
      </Card>
    </div>
  );
}
