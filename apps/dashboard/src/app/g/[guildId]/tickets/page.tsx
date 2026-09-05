import { Badge, Card, EmptyState, Table } from '@/components/ui';
import { apiGet } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface Ticket {
  id: string;
  number: number;
  category: string;
  subject: string | null;
  status: string;
  openerId: string;
  claimedById: string | null;
  createdAt: string;
}

const STATUS_STYLES: Record<string, string> = {
  OPEN: 'bg-success/15 text-success',
  CLAIMED: 'bg-accent/15 text-accent-soft',
  LOCKED: 'bg-warning/15 text-warning',
  CLOSED: 'bg-base-700 text-slate-400',
};

export default async function TicketsPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const tickets = await apiGet<Ticket[]>(`/api/v1/guilds/${guildId}/tickets?pageSize=50`);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-100">Tickets</h1>
        <p className="mt-1 text-sm text-slate-500">
          Support-Anfragen mit Kategorie, Bearbeiter und Transkript beim Schliessen.
        </p>
      </header>

      <Card title={`Tickets (${tickets?.length ?? 0})`}>
        {tickets && tickets.length > 0 ? (
          <Table head={['Nummer', 'Betreff', 'Kategorie', 'Status', 'Ersteller', 'Bearbeiter', 'Erstellt']}>
            {tickets.map((ticket) => (
              <tr key={ticket.id} className="transition hover:bg-base-850/60">
                <td className="table-cell font-mono text-xs text-slate-400">
                  #{String(ticket.number).padStart(4, '0')}
                </td>
                <td className="table-cell text-slate-300">{ticket.subject ?? '—'}</td>
                <td className="table-cell">
                  <Badge>{ticket.category}</Badge>
                </td>
                <td className="table-cell">
                  <Badge className={STATUS_STYLES[ticket.status] ?? ''}>{ticket.status}</Badge>
                </td>
                <td className="table-cell font-mono text-xs text-slate-500">{ticket.openerId}</td>
                <td className="table-cell font-mono text-xs text-slate-500">{ticket.claimedById ?? '—'}</td>
                <td className="table-cell text-xs text-slate-500">{formatDate(ticket.createdAt)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState
            title="Keine Tickets"
            description="Ueber ein Ticket-Panel oder /ticket open eroeffnete Anfragen erscheinen hier."
          />
        )}
      </Card>
    </div>
  );
}
