import type { Services } from './container.js';
import type { ScheduledJob } from './types.js';

/**
 * Einfacher, robuster Scheduler fuer wiederkehrende Aufgaben.
 *
 * - `singleton`-Jobs laufen ueber einen verteilten Lock nur einmal im Cluster.
 * - Fehler beenden nie den Prozess; sie werden geloggt und der Job laeuft weiter.
 * - Ueberlappende Laeufe werden verhindert.
 */
export class Scheduler {
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly running = new Set<string>();

  constructor(private readonly services: Services) {}

  start(jobs: ScheduledJob[]): void {
    for (const job of jobs) {
      if (job.runOnStart) void this.run(job);
      const timer = setInterval(() => void this.run(job), job.intervalMs);
      timer.unref?.();
      this.timers.push(timer);
    }
    this.services.log.info('Scheduler gestartet', { jobs: jobs.length });
  }

  private async run(job: ScheduledJob): Promise<void> {
    if (this.running.has(job.name)) {
      this.services.log.debug('Job laeuft bereits — Lauf uebersprungen', { job: job.name });
      return;
    }
    this.running.add(job.name);
    const startedAt = Date.now();
    try {
      if (job.singleton) {
        const executed = await this.services.cache.withLock(
          `job:${job.name}`,
          Math.max(5_000, Math.min(job.intervalMs, 60_000)),
          async () => {
            await job.execute(this.services);
            return true;
          },
        );
        if (executed === null) return;
      } else {
        await job.execute(this.services);
      }
      this.services.log.debug('Job abgeschlossen', { job: job.name, durationMs: Date.now() - startedAt });
    } catch (error) {
      this.services.log.error('Job fehlgeschlagen', error, { job: job.name });
    } finally {
      this.running.delete(job.name);
    }
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
  }
}
