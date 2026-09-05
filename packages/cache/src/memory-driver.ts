import type { CacheDriver, SetOptions, TokenBucketResult } from './driver.js';

interface Entry {
  value: string;
  expiresAt: number | null;
}

/**
 * In-Memory-Treiber fuer Dev-Modus und Unit-Tests.
 * Bewusst nicht clusterfaehig — in der Produktion immer Redis verwenden.
 */
export class MemoryCacheDriver implements CacheDriver {
  readonly kind = 'memory' as const;
  private readonly store = new Map<string, Entry>();
  private readonly windows = new Map<string, Array<{ member: string; score: number }>>();
  private readonly subscribers = new Map<string, Set<(message: string) => void>>();
  private readonly sweeper: NodeJS.Timeout;

  constructor() {
    this.sweeper = setInterval(() => this.sweep(), 30_000);
    this.sweeper.unref?.();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) this.store.delete(key);
    }
  }

  private read(key: string): Entry | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key: string): Promise<string | null> {
    return this.read(key)?.value ?? null;
  }

  async set(key: string, value: string, options: SetOptions = {}): Promise<boolean> {
    if (options.ifNotExists && this.read(key)) return false;
    this.store.set(key, { value, expiresAt: options.ttlMs ? Date.now() + options.ttlMs : null });
    return true;
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) if (this.store.delete(key)) count++;
    return count;
  }

  async incrBy(key: string, amount: number, ttlMs?: number): Promise<number> {
    const current = Number(this.read(key)?.value ?? '0');
    const next = current + amount;
    const existing = this.store.get(key);
    this.store.set(key, {
      value: String(next),
      expiresAt: existing?.expiresAt ?? (ttlMs ? Date.now() + ttlMs : null),
    });
    return next;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.read(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*')}$`);
    const now = Date.now();
    return [...this.store.entries()]
      .filter(([key, entry]) => regex.test(key) && (entry.expiresAt === null || entry.expiresAt > now))
      .map(([key]) => key);
  }

  async tokenBucket(key: string, limit: number, windowMs: number, cost = 1): Promise<TokenBucketResult> {
    const now = Date.now();
    const entry = this.read(key);
    const used = entry ? Number(entry.value) : 0;
    const expiresAt = entry?.expiresAt ?? now + windowMs;
    if (used + cost > limit) {
      return { allowed: false, remaining: Math.max(0, limit - used), resetAfterMs: Math.max(0, expiresAt - now) };
    }
    this.store.set(key, { value: String(used + cost), expiresAt });
    return { allowed: true, remaining: limit - used - cost, resetAfterMs: Math.max(0, expiresAt - now) };
  }

  async slidingWindowAdd(key: string, member: string, now: number, windowMs: number): Promise<number> {
    const list = this.windows.get(key) ?? [];
    const cutoff = now - windowMs;
    const pruned = list.filter((item) => item.score > cutoff);
    pruned.push({ member, score: now });
    this.windows.set(key, pruned);
    return pruned.length;
  }

  async publish(channel: string, message: string): Promise<void> {
    for (const handler of this.subscribers.get(channel) ?? []) {
      queueMicrotask(() => handler(message));
    }
  }

  async subscribe(channel: string, handler: (message: string) => void): Promise<() => Promise<void>> {
    const set = this.subscribers.get(channel) ?? new Set();
    set.add(handler);
    this.subscribers.set(channel, set);
    return async () => { set.delete(handler); };
  }

  async ping(): Promise<boolean> { return true; }

  async close(): Promise<void> {
    clearInterval(this.sweeper);
    this.store.clear();
    this.windows.clear();
    this.subscribers.clear();
  }
}
