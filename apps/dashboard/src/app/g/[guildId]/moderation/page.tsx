import { Badge, Card, EmptyState, Table } from '@/components/ui';
import { apiGet } from '@/lib/api';
import { ACTION_STYLES, formatDate } from '@/lib/format';

interface CaseEntry {
  id: string;
  caseId: string;
  action: string;
  targetId: string;
  targetTag: string | null;
  moderatorId: string;
  reason: string;
  durationMs: number | null;
  active: boolean;
  createdAt: string;
}

export default async function ModerationPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const cases = await apiGet<CaseEntry[]>(`/api/v1/guilds/${guildId}/cases?pageSize=50`);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-100">Moderation</h1>
        <p className="mt-1 text-sm text-slate-500">
          Jede Massnahme erhaelt eine eindeutige Fall-ID und bleibt dauerhaft nachvollziehbar.
        </p>
      </header>

      <Card title={`Faelle (${cases?.length ?? 0})`}>
        {cases && cases.length > 0 ? (
          <Table head={['Fall', 'Aktion', 'Ziel', 'Grund', 'Moderator', 'Zeitpunkt', 'Status']}>
            {cases.map((entry) => (
              <tr key={entry.id} className="transition hover:bg-base-850/60">
                <td className="table-cell font-mono text-xs text-slate-400">{entry.caseId}</td>
                <td className="table-cell">
                  <Badge className={ACTION_STYLES[entry.action] ?? 'bg-base-700 text-slate-300'}>
                    {entry.action}
                  </Badge>
                </td>
                <td className="table-cell text-slate-300">{entry.targetTag ?? entry.targetId}</td>
                <td className="table-cell max-w-xs truncate text-slate-400">{entry.reason}</td>
                <td className="table-cell font-mono text-xs text-slate-500">{entry.moderatorId}</td>
                <td className="table-cell text-xs text-slate-500">{formatDate(entry.createdAt)}</td>
                <td className="table-cell">
                  {entry.active ? (
                    <Badge className="bg-success/15 text-success">aktiv</Badge>
                  ) : (
                    <Badge>abgeschlossen</Badge>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState
            title="Keine Moderationsfaelle"
            description="Sobald ein Moderator eine Massnahme ausfuehrt, erscheint sie hier mit Fall-ID, Grund und Zeitpunkt."
          />
        )}
      </Card>
    </div>
  );
}
