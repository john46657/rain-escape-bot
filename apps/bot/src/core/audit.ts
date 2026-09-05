import type { AuditLogEntity } from '@nexus/database';
import { redact } from '@nexus/shared';
import type { Services } from './container.js';

/**
 * Schreibt einen Audit-Eintrag (Regel 34) und veroeffentlicht ihn fuer das
 * Dashboard. Metadaten werden vor dem Speichern von Secrets bereinigt.
 */
export type AuditDeps = Pick<Services, 'store' | 'log' | 'publish'>;

export async function writeAudit(
  services: AuditDeps,
  entry: Omit<AuditLogEntity, 'id' | 'createdAt' | 'metadata'> & { metadata?: Record<string, unknown> },
): Promise<void> {
  const metadata = redact(entry.metadata ?? {});
  try {
    const stored = await services.store.audit.log({ ...entry, metadata });
    services.log.audit(entry.action, {
      actorId: entry.actorId,
      guildId: entry.guildId ?? undefined,
      targetId: entry.targetId ?? undefined,
      result: entry.result,
    });
    await services.publish('audit.created', stored);
  } catch (error) {
    // Ein fehlgeschlagenes Audit darf die Aktion nicht abbrechen, muss aber auffallen.
    services.log.error('Audit-Eintrag konnte nicht gespeichert werden', error, { action: entry.action });
  }
}
