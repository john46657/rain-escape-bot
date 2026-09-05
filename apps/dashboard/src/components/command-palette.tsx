'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity, BarChart3, Coins, FileClock, Gamepad2, KeyRound, LayoutDashboard,
  Search, Settings, Shield, Ticket,
} from 'lucide-react';

interface Command {
  id: string;
  label: string;
  hint: string;
  icon: typeof Search;
  href: string;
  keywords: string;
}

/**
 * Befehlszentrale (Regel 45).
 * Oeffnet mit Cmd/Strg+K, filtert unscharf und navigiert per Tastatur.
 */
export function CommandPalette({ guildId }: { guildId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(() => {
    const base = `/g/${guildId}`;
    return [
      { id: 'overview', label: 'Uebersicht oeffnen', hint: 'Dashboard', icon: LayoutDashboard, href: base, keywords: 'start home uebersicht dashboard' },
      { id: 'moderation', label: 'Moderationsfaelle', hint: 'Faelle & Verwarnungen', icon: Shield, href: `${base}/moderation`, keywords: 'ban kick warn faelle historie' },
      { id: 'security', label: 'Sicherheitszentrale', hint: 'Vorfaelle & AutoMod', icon: Activity, href: `${base}/security`, keywords: 'antinuke automod incidents lockdown raid' },
      { id: 'tickets', label: 'Tickets', hint: 'Support-Anfragen', icon: Ticket, href: `${base}/tickets`, keywords: 'support ticket anfragen' },
      { id: 'roblox', label: 'Roblox-Server', hint: 'Spiele & Instanzen', icon: Gamepad2, href: `${base}/roblox`, keywords: 'roblox game universe server jobid' },
      { id: 'engagement', label: 'Level & Wirtschaft', hint: 'Ranglisten', icon: Coins, href: `${base}/engagement`, keywords: 'xp level economy muenzen leaderboard' },
      { id: 'analytics', label: 'Analytics', hint: 'Kennzahlen', icon: BarChart3, href: `${base}/analytics`, keywords: 'statistik metriken wachstum' },
      { id: 'audit', label: 'Audit-Log', hint: 'Wer hat was getan', icon: FileClock, href: `${base}/audit`, keywords: 'audit protokoll log verlauf' },
      { id: 'settings', label: 'Einstellungen', hint: 'Module & Kanaele', icon: Settings, href: `${base}/settings`, keywords: 'config einstellungen module sprache' },
      { id: 'developers', label: 'Entwicklerportal', hint: 'API-Keys & Webhooks', icon: KeyRound, href: `${base}/developers`, keywords: 'api key token webhook entwickler' },
    ];
  }, [guildId]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter(
      (command) =>
        command.label.toLowerCase().includes(needle) ||
        command.hint.toLowerCase().includes(needle) ||
        command.keywords.includes(needle),
    );
  }, [commands, query]);

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((previous) => !previous);
        setQuery('');
        setCursor(0);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 20);
  }, [open]);

  if (!open) return null;

  const select = (index: number): void => {
    const command = filtered[index];
    if (!command) return;
    setOpen(false);
    router.push(command.href);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        className="w-full max-w-xl animate-slide-up overflow-hidden rounded-xl border border-base-700 bg-base-900 shadow-glow"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Befehlszentrale"
      >
        <div className="flex items-center gap-3 border-b border-base-700 px-4">
          <Search className="h-4 w-4 text-slate-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setCursor((previous) => Math.min(previous + 1, filtered.length - 1));
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setCursor((previous) => Math.max(previous - 1, 0));
              }
              if (event.key === 'Enter') select(cursor);
            }}
            placeholder="Befehl oder Seite suchen…"
            className="w-full bg-transparent py-3.5 text-sm text-slate-100 outline-none placeholder:text-slate-600"
          />
          <kbd className="rounded border border-base-700 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">ESC</kbd>
        </div>

        <ul className="max-h-80 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-slate-500">Keine Treffer</li>
          ) : (
            filtered.map((command, index) => {
              const Icon = command.icon;
              return (
                <li key={command.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => select(index)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                      index === cursor ? 'bg-accent/10 text-accent-soft' : 'text-slate-300 hover:bg-base-800'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1 text-sm">{command.label}</span>
                    <span className="text-xs text-slate-600">{command.hint}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
