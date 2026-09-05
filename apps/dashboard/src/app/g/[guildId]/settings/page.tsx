import { Badge, Card } from '@/components/ui';
import { apiGet } from '@/lib/api';

interface Overview {
  guild: { name: string; locale: string; premiumTier: string };
  config: Record<string, unknown>;
}

const MODULE_LABELS: Array<{ key: string; label: string; description: string }> = [
  { key: 'moderationEnabled', label: 'Moderation', description: 'Befehle, Fallhistorie, Verwarnungen' },
  { key: 'automodEnabled', label: 'AutoMod', description: 'Spam-, Link- und Scam-Filter' },
  { key: 'antiNukeEnabled', label: 'Anti-Nuke', description: 'Schutz vor Massenaktionen' },
  { key: 'ticketsEnabled', label: 'Tickets', description: 'Support mit Transkripten' },
  { key: 'levelsEnabled', label: 'Level', description: 'XP und Rollenbelohnungen' },
  { key: 'economyEnabled', label: 'Wirtschaft', description: 'Waehrung, Shop, Inventar' },
  { key: 'gamesEnabled', label: 'Spiele', description: 'Minispiele mit Einsatz' },
  { key: 'giveawaysEnabled', label: 'Gewinnspiele', description: 'Teilnahme per Button' },
  { key: 'robloxEnabled', label: 'Roblox', description: 'Verifizierung, Server, Kommandos' },
  { key: 'musicEnabled', label: 'Musik', description: 'Erfordert Lavalink-Knoten' },
  { key: 'aiEnabled', label: 'KI-Assistent', description: 'Optional, OpenAI-kompatibel' },
];

const CHANNEL_LABELS: Array<{ key: string; label: string }> = [
  { key: 'modLogChannelId', label: 'Mod-Log' },
  { key: 'auditLogChannelId', label: 'Audit-Log' },
  { key: 'securityChannelId', label: 'Sicherheitsmeldungen' },
  { key: 'welcomeChannelId', label: 'Willkommen' },
  { key: 'suggestionChannelId', label: 'Vorschlaege' },
  { key: 'starboardChannelId', label: 'Starboard' },
];

export default async function SettingsPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const overview = await apiGet<Overview>(`/api/v1/guilds/${guildId}`);
  const config = overview?.config ?? {};

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-100">Einstellungen</h1>
        <p className="mt-1 text-sm text-slate-500">
          Aenderungen wirken sofort — der Bot invalidiert seinen Konfigurations-Cache ueber den Ereignisbus.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Module">
          <ul className="space-y-2">
            {MODULE_LABELS.map((module) => {
              const enabled = Boolean(config[module.key]);
              return (
                <li
                  key={module.key}
                  className="flex items-center justify-between gap-3 rounded-lg bg-base-850/50 px-3 py-2.5"
                >
                  <div>
                    <p className="text-sm text-slate-200">{module.label}</p>
                    <p className="text-xs text-slate-600">{module.description}</p>
                  </div>
                  <Badge className={enabled ? 'bg-success/15 text-success' : 'bg-base-700 text-slate-400'}>
                    {enabled ? 'aktiv' : 'aus'}
                  </Badge>
                </li>
              );
            })}
          </ul>
        </Card>

        <div className="space-y-6">
          <Card title="Kanaele">
            <ul className="space-y-2 text-sm">
              {CHANNEL_LABELS.map((channel) => (
                <li key={channel.key} className="flex items-center justify-between gap-3">
                  <span className="text-slate-400">{channel.label}</span>
                  <code className="rounded bg-base-800 px-2 py-0.5 font-mono text-xs text-slate-400">
                    {String(config[channel.key] ?? '—')}
                  </code>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Allgemein">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-400">Sprache</dt>
                <dd className="text-slate-200">{overview?.guild.locale === 'en' ? 'Englisch' : 'Deutsch'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Tarif</dt>
                <dd className="text-slate-200">{overview?.guild.premiumTier}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Waehrung</dt>
                <dd className="text-slate-200">
                  {String(config['currencySymbol'] ?? '⬢')} {String(config['currencyName'] ?? 'Muenzen')}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">XP pro Nachricht</dt>
                <dd className="text-slate-200">{String(config['xpPerMessage'] ?? 0)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Mindest-Kontoalter</dt>
                <dd className="text-slate-200">{String(config['minAccountAgeDays'] ?? 0)} Tage</dd>
              </div>
            </dl>
            <p className="mt-4 rounded-lg bg-base-850 p-3 text-xs text-slate-500">
              Schreibende Aenderungen laufen ueber
              <code className="mx-1 rounded bg-base-800 px-1.5 py-0.5 font-mono">
                PATCH /api/v1/guilds/{guildId}/config
              </code>
              und erfordern die Berechtigung <code className="font-mono">discord.config.manage</code>.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
