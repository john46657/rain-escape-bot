/**
 * Serverseitiger API-Client des Dashboards.
 *
 * Wichtig (Regel 54): Aufrufe erfolgen ausschliesslich auf dem Server.
 * Dadurch bleiben Session-Cookie und interne API-Adresse im Backend, und
 * der Browser erhaelt nur fertig gerenderte Daten.
 */
import { cookies } from 'next/headers';

const BASE_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

export interface ApiResult<T> {
  data: T;
  meta?: { total?: number; page?: number; pageSize?: number };
}

export async function apiGet<T>(path: string, options: { revalidate?: number } = {}): Promise<T | null> {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get('nexus_session')?.value;
    const response = await fetch(`${BASE_URL}${path}`, {
      headers: session ? { cookie: `nexus_session=${session}` } : {},
      next: { revalidate: options.revalidate ?? 0 },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as ApiResult<T>;
    return payload.data;
  } catch {
    // Die API kann waehrend eines Neustarts kurz nicht erreichbar sein;
    // die Oberflaeche zeigt dann einen Leerzustand statt eines Fehlers.
    return null;
  }
}

export async function apiHealth(): Promise<{
  status: string;
  checks?: Record<string, { ok: boolean; driver: string }>;
  devMode?: boolean;
} | null> {
  try {
    const response = await fetch(`${BASE_URL}/health/ready`, { cache: 'no-store' });
    return (await response.json()) as { status: string };
  } catch {
    return null;
  }
}
