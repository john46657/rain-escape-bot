import Link from 'next/link';
import { ArrowRight, Bot, Gamepad2, Shield } from 'lucide-react';
import { apiGet, apiHealth } from '@/lib/api';

interface GuildSummary {
  id: string;
  name: string;
  memberCount: number;
  premiumTier: string;
}

/** Serverauswahl — Einstieg in das Dashboard. */
export default async function HomePage() {
  const [guilds, health] = await Promise.all([apiGet<GuildSummary[]>('/api/v1/guilds'), apiHealth()]);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6 py-16">
      <div className="mb-10 flex items-center gap-4">
        <div className="grid h-12 w-12 place-items-center rounded-xl bg-accent/15 text-accent-soft ring-1 ring-inset ring-accent/30">
          <Bot className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">NEXUS</h1>
          <p className="text-sm text-slate-500">Discord × Roblox — Verwaltung, Sicherheit und Community</p>
        </div>
      </div>

      <div className="card divide-y divide-base-800">
        <div className="card-header">
          <h2 className="card-title">Deine Server</h2>
          <span className="text-xs text-slate-500">
            {health?.status === 'ok' ? '🟢 API erreichbar' : '🔴 API nicht erreichbar'}
            {health?.devMode ? ' · DEV_MODE' : ''}
          </span>
        </div>

        {guilds && guilds.length > 0 ? (
          guilds.map((guild) => (
            <Link
              key={guild.id}
              href={`/g/${guild.id}`}
              className="flex items-center justify-between px-5 py-4 transition hover:bg-base-850"
            >
              <div>
                <p className="text-sm font-medium text-slate-100">{guild.name}</p>
                <p className="text-xs text-slate-500">
                  {guild.memberCount.toLocaleString('de-DE')} Mitglieder · Tarif {guild.premiumTier}
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-600" />
            </Link>
          ))
        ) : (
          <div className="px-5 py-10 text-center text-sm text-slate-500">
            Keine Server gefunden. Lade NEXUS auf einen Discord-Server ein oder starte die API mit
            <code className="mx-1 rounded bg-base-800 px-1.5 py-0.5 font-mono text-xs">DEV_MODE=true</code>
            fuer Demo-Daten.
          </div>
        )}
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="card p-5">
          <Shield className="mb-2 h-5 w-5 text-accent-soft" />
          <p className="text-sm font-medium text-slate-200">Sicherheit zuerst</p>
          <p className="mt-1 text-xs text-slate-500">
            AutoMod, Anti-Nuke, Notfallmodus und ein vollstaendiges Audit-Log — jede sicherheitsrelevante
            Aktion wird geprueft und protokolliert.
          </p>
        </div>
        <div className="card p-5">
          <Gamepad2 className="mb-2 h-5 w-5 text-roblox" />
          <p className="text-sm font-medium text-slate-200">Roblox eingebunden</p>
          <p className="mt-1 text-xs text-slate-500">
            Signierte Server-Kommunikation, Verifizierung ueber Einmalcodes, Live-Serveruebersicht und
            plattformuebergreifende Belohnungen.
          </p>
        </div>
      </div>
    </main>
  );
}
