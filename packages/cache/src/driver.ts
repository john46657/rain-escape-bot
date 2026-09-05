/**
 * Cache-/State-Abstraktion.
 *
 * Produktion: Redis (ioredis). Lokaler Dev-Modus/Tests: In-Memory-Treiber mit
 * identischer Semantik. Dadurch laufen Cooldowns, Rate Limits, Locks und
 * Verifizierungscodes ueberall gleich — nur die Persistenz unterscheidet sich.
 */
export interface SetOptions {
  ttlMs?: number;
  /** Nur setzen, wenn der Schluessel noch nicht existiert (Locks). */
  ifNotExists?: boolean;
}

export interface TokenBucketResult {
  allowed: boolean;
  remaining: number;
  resetAfterMs: number;
}

export interface CacheDriver {
  readonly kind: 'redis' | 'memory';
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: SetOptions): Promise<boolean>;
  del(...keys: string[]): Promise<number>;
  incrBy(key: string, amount: number, ttlMs?: number): Promise<number>;
  ttl(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  /** Atomarer Token-Bucket fuer Rate Limits. */
  tokenBucket(key: string, limit: number, windowMs: number, cost?: number): Promise<TokenBucketResult>;
  /** Sortierte Liste mit Score = Timestamp; fuer Sliding-Window-Analysen. */
  slidingWindowAdd(key: string, member: string, now: number, windowMs: number): Promise<number>;
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: (message: string) => void): Promise<() => Promise<void>>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}
