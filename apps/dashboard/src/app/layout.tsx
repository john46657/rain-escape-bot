import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'NEXUS — Discord × Roblox Management',
  description: 'Moderation, Sicherheit, Community und Roblox-Integration in einer Oberflaeche.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body className="min-h-screen bg-base-950">{children}</body>
    </html>
  );
}
