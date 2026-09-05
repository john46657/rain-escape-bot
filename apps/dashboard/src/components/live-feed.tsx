'use client';

import { useEffect, useRef, useState } from 'react';
import { Radio } from 'lucide-react';

interface FeedEntry {
  id: number;
  topic: string;
  summary: string;
  at: number;
}

const TOPIC_LABELS: Record<string, string> = {
  connected: 'Verbindung hergestellt',
  'moderation.case': 'Moderationsfall',
  'security.incident': 'Sicherheitsvorfall',
  'security.automod': 'AutoMod',
  'security.lockdown': 'Notfallmodus',
  'ticket.created': 'Ticket eroeffnet',
  'ticket.closed': 'Ticket geschlossen',
  'roblox.event': 'Roblox-Event',
  'roblox.heartbeat': 'Roblox-Heartbeat',
  'roblox.verified': 'Roblox verifiziert',
  'levels.levelup': 'Level-Aufstieg',
  'config.updated': 'Konfiguration geaendert',
};

/**
 * Live-Ereignisse ueber WebSocket (Regel 39).
 * Faellt die Verbindung aus, wird mit wachsendem Abstand neu verbunden.
 */
export function LiveFeed({ guildId }: { guildId: string }) {
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [status, setStatus] = useState<'connecting' | 'online' | 'offline'>('connecting');
  const counter = useRef(0);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout>;
    let closed = false;

    const connect = (): void => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${protocol}://${window.location.host}/api/v1/realtime?guildId=${guildId}`);

      socket.onopen = () => {
        retry = 0;
        setStatus('online');
      };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as {
            topic: string;
            payload: Record<string, unknown>;
          };
          counter.current += 1;
          setEntries((previous) =>
            [
              {
                id: counter.current,
                topic: message.topic,
                summary: describe(message.topic, message.payload),
                at: Date.now(),
              },
              ...previous,
            ].slice(0, 25),
          );
        } catch {
          /* fehlerhafte Nachrichten ignorieren */
        }
      };
      socket.onclose = () => {
        if (closed) return;
        setStatus('offline');
        retry += 1;
        timer = setTimeout(connect, Math.min(15_000, 1_000 * 2 ** retry));
      };
      socket.onerror = () => socket?.close();
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [guildId]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <Radio
          className={`h-3.5 w-3.5 ${status === 'online' ? 'text-success' : status === 'connecting' ? 'text-warning' : 'text-danger'}`}
        />
        <span className="text-slate-500">
          {status === 'online'
            ? 'Live verbunden'
            : status === 'connecting'
              ? 'Verbinde…'
              : 'Getrennt — neuer Versuch laeuft'}
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-base-700 px-4 py-8 text-center text-xs text-slate-600">
          Noch keine Ereignisse. Aktionen im Discord-Server oder im Spiel erscheinen hier sofort.
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="animate-fade-in rounded-lg border border-base-800 bg-base-850/60 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-accent-soft">
                  {TOPIC_LABELS[entry.topic] ?? entry.topic}
                </span>
                <span className="font-mono text-[10px] text-slate-600">
                  {new Date(entry.at).toLocaleTimeString('de-DE')}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-400">{entry.summary}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function describe(topic: string, payload: Record<string, unknown>): string {
  switch (topic) {
    case 'moderation.case':
      return `${String(payload['action'] ?? '')} · Fall ${String(payload['caseId'] ?? '')}`;
    case 'security.incident':
      return `${String(payload['severity'] ?? '')} · ${String(payload['kind'] ?? '')}`;
    case 'roblox.heartbeat':
      return `Instanz ${String(payload['jobId'] ?? '').slice(0, 12)} · ${String(payload['playerCount'] ?? 0)} Spieler`;
    case 'roblox.event':
      return `${String(payload['type'] ?? '')} · Nutzer ${String(payload['robloxUserId'] ?? '—')}`;
    case 'connected':
      return 'Ereignisstrom abonniert';
    default:
      return Object.entries(payload ?? {})
        .slice(0, 3)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(' · ');
  }
}
