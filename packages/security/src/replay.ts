import type { CacheService } from '@nexus/cache';

/**
 * Replay-Schutz: jede Nonce darf innerhalb des Gueltigkeitsfensters
 * genau einmal verwendet werden.
 */
export class ReplayGuard {
  constructor(
    private readonly cache: CacheService,
    private readonly windowSeconds = 300,
  ) {}

  /** true = Nonce war neu und wurde registriert. */
  async register(scope: string, nonce: string): Promise<boolean> {
    return this.cache.markOnce(`nonce:${scope}`, nonce, this.windowSeconds * 1000);
  }
}
