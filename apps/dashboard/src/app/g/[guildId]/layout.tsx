import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { CommandPalette } from '@/components/command-palette';
import { Sidebar } from '@/components/sidebar';
import { apiGet } from '@/lib/api';

interface GuildPayload {
  guild: { discordId: string; name: string; premiumTier: string; memberCount: number };
}

export default async function GuildLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const payload = await apiGet<GuildPayload>(`/api/v1/guilds/${guildId}`);
  if (!payload) notFound();

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar guildId={guildId} guildName={payload.guild.name} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-8 py-8">{children}</div>
      </div>
      <CommandPalette guildId={guildId} />
    </div>
  );
}
