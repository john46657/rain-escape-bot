'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity, BarChart3, Bot, Coins, FileClock, Gamepad2, KeyRound, LayoutDashboard,
  MessageSquare, Settings, Shield, Ticket,
} from 'lucide-react';

const SECTIONS: Array<{ title: string; items: Array<{ href: string; label: string; icon: typeof Activity }> }> = [
  {
    title: 'Uebersicht',
    items: [
      { href: '', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    title: 'Sicherheit',
    items: [
      { href: '/moderation', label: 'Moderation', icon: Shield },
      { href: '/security', label: 'Sicherheitszentrale', icon: Activity },
      { href: '/audit', label: 'Audit-Log', icon: FileClock },
    ],
  },
  {
    title: 'Community',
    items: [
      { href: '/tickets', label: 'Tickets', icon: Ticket },
      { href: '/engagement', label: 'Level & Wirtschaft', icon: Coins },
    ],
  },
  {
    title: 'Roblox',
    items: [{ href: '/roblox', label: 'Spiele & Server', icon: Gamepad2 }],
  },
  {
    title: 'Verwaltung',
    items: [
      { href: '/settings', label: 'Einstellungen', icon: Settings },
      { href: '/developers', label: 'Entwicklerportal', icon: KeyRound },
    ],
  },
];

export function Sidebar({ guildId, guildName }: { guildId: string; guildName: string }) {
  const pathname = usePathname();
  const base = `/g/${guildId}`;

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-base-800 bg-base-900/40">
      <div className="flex items-center gap-3 border-b border-base-800 px-5 py-4">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 text-accent-soft ring-1 ring-inset ring-accent/30">
          <Bot className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-100">NEXUS</p>
          <p className="truncate text-xs text-slate-500">{guildName}</p>
        </div>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-600">
              {section.title}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const href = `${base}${item.href}`;
                const active = pathname === href;
                const Icon = item.icon;
                return (
                  <Link key={href} href={href} className={`nav-link ${active ? 'nav-link-active' : ''}`}>
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-base-800 px-5 py-3">
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <MessageSquare className="h-3.5 w-3.5" />
          <kbd className="rounded border border-base-700 px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
          Befehlszentrale
        </p>
      </div>
    </aside>
  );
}
