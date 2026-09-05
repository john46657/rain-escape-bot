import { RateLimitError } from '@nexus/shared';
import type { CacheDriver, TokenBucketResult } from './driver.js';
import { MemoryCacheDriver } from './memory-driver.js';

export interface CacheServiceOptions {
  driver: CacheDriver;
  prefix?: string;
}

/**
 * Fachliche Fassade ueber dem Cache-Treiber: Namespacing, Cooldowns,
 * Rate Limits, Locks, JSON-Cache und Pub/Sub (Regel 39).
 */
export class CacheService {
  private readonly driver: CacheDriver;
  private readonly prefix: string;

  constructor(options: CacheServiceOptions) {
    this.driver = options.driver;
    this.prefix = options.prefix ?? 'nexus';
  }

  static memory(prefix = 'nexus'): CacheService {
    return new CacheService({ driver: new MemoryCacheDriver(), prefix });
  }

  get kind(): 'redis' | 'memory' { return this.driver.kind; }
  get raw(): CacheDriver { return this.driver; }

  key(...parts: Array<string | number>): string {
    return [this.prefix, ...parts].join(':');
  }

  // ---------------------------------------------------------------- JSON
  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.driver.get(this.key(key));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      await this.driver.del(this.key(key));
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlMs?: number): Promise<void> {
    await this.driver.set(this.key(key), JSON.stringify(value), ttlMs ? { ttlMs } : {});
  }

  async delete(...keys: string[]): Promise<number> {
    return this.driver.del(...keys.map((key) => this.key(key)));
  }

  /** Cache-Aside: liest aus dem Cache oder faellt auf den Loader zurueck. */
  async remember<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const cached = await this.getJson<T>(key);
    if (cached !== null) return cached;
    const value = await loader();
    await this.setJson(key, value, ttlMs);
    return value;
  }

  async invalidatePrefix(prefix: string): Promise<number> {
    const keys = await this.driver.keys(`${this.key(prefix)}*`);
    return keys.length ? this.driver.del(...keys) : 0;
  }

  // ------------------------------------------------------------ Cooldown
  /** Gibt die Restzeit in ms zurueck (0 = kein Cooldown aktiv). */
  async checkCooldown(scope: string, id: string): Promise<number> {
    const seconds = await this.driver.ttl(this.key('cooldown', scope, id));
    return seconds > 0 ? seconds * 1000 : 0;
  }

  async setCooldown(scope: string, id: string, durationMs: number): Promise<void> {
    await this.driver.set(this.key('cooldown', scope, id), '1', { ttlMs: durationMs });
  }

  /** Prueft und setzt den Cooldown atomar; wirft bei aktivem Cooldown. */
  async consumeCooldown(scope: string, id: string, durationMs: number): Promise<void> {
    const key = this.key('cooldown', scope, id);
    const acquired = await this.driver.set(key, '1', { ttlMs: durationMs, ifNotExists: true });
    if (!acquired) {
      const seconds = await this.driver.ttl(key);
      throw new RateLimitError(Math.max(0, seconds) * 1000, { scope });
    }
  }

  async clearCooldown(scope: string, id: string): Promise<void> {
    await this.driver.del(this.key('cooldown', scope, id));
  }

  // ---------------------------------------------------------- Rate Limit
  async rateLimit(scope: string, id: string, limit: number, windowMs: number, cost = 1): Promise<TokenBucketResult> {
    return this.driver.tokenBucket(this.key('ratelimit', scope, id), limit, windowMs, cost);
  }

  async enforceRateLimit(scope: string, id: string, limit: number, windowMs: number, cost = 1): Promise<void> {
    const result = await this.rateLimit(scope, id, limit, windowMs, cost);
    if (!result.allowed) throw new RateLimitError(result.resetAfterMs, { scope, limit });
  }

  /** Zaehlt Ereignisse in einem gleitenden Fenster (Anti-Spam, Anti-Nuke). */
  async slidingWindow(scope: string, id: string, member: string, windowMs: number): Promise<number> {
    return this.driver.slidingWindowAdd(this.key('window', scope, id), member, Date.now(), windowMs);
  }

  // --------------------------------------------------------------- Locks
  /** Verteilter Lock; verhindert doppelte Ausfuehrung ueber Shards hinweg. */
  async acquireLock(name: string, ttlMs = 10_000): Promise<(() => Promise<void>) | null> {
    const key = this.key('lock', name);
    const acquired = await this.driver.set(key, String(process.pid), { ttlMs, ifNotExists: true });
    if (!acquired) return null;
    return async () => { await this.driver.del(key); };
  }

  async withLock<T>(name: string, ttlMs: number, operation: () => Promise<T>): Promise<T | null> {
    const release = await this.acquireLock(name, ttlMs);
    if (!release) return null;
    try {
      return await operation();
    } finally {
      await release();
    }
  }

  /** Idempotenz-Guard: liefert true, wenn dieser Schluessel neu ist. */
  /** Zaehler erhoehen (z. B. Abstimmungen); gibt den neuen Wert zurueck. */
  async increment(key: string, by = 1, ttlMs?: number): Promise<number> {
    return this.driver.incrBy(this.key('counter', key), by, ttlMs);
  }

  async markOnce(scope: string, id: string, ttlMs: number): Promise<boolean> {
    return this.driver.set(this.key('once', scope, id), '1', { ttlMs, ifNotExists: true });
  }

  // ------------------------------------------------------------- Pub/Sub
  async publish(topic: string, payload: unknown): Promise<void> {
    await this.driver.publish(this.key('bus', topic), JSON.stringify(payload));
  }

  async subscribe<T>(topic: string, handler: (payload: T) => void): Promise<() => Promise<void>> {
    return this.driver.subscribe(this.key('bus', topic), (message) => {
      try {
        handler(JSON.parse(message) as T);
      } catch {
        /* fehlerhafte Nachrichten werden ignoriert, um den Bus nicht zu blockieren */
      }
    });
  }

  async healthy(): Promise<boolean> {
    try {
      return await this.driver.ping();
    } catch {
      return false;
    }
  }

  async close(): Promise<void> { await this.driver.close(); }
}
