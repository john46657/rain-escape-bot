import type { Redis } from 'ioredis';
import type { CacheDriver, SetOptions, TokenBucketResult } from './driver.js';

/** Atomarer Token-Bucket. Muss serverseitig laufen, damit kein Race entsteht. */
const TOKEN_BUCKET_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
if current + cost > limit then
  local pttl = redis.call('PTTL', KEYS[1])
  if pttl < 0 then pttl = window end
  return {0, limit - current, pttl}
end
local updated = redis.call('INCRBY', KEYS[1], cost)
if updated == cost then redis.call('PEXPIRE', KEYS[1], window) end
local pttl = redis.call('PTTL', KEYS[1])
if pttl < 0 then pttl = window end
return {1, limit - updated, pttl}
`;

const SLIDING_WINDOW_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, tonumber(ARGV[2]) - tonumber(ARGV[3]))
redis.call('ZADD', KEYS[1], tonumber(ARGV[2]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]))
return redis.call('ZCARD', KEYS[1])
`;

export class RedisCacheDriver implements CacheDriver {
  readonly kind = 'redis' as const;
  private subscriber?: Redis;

  constructor(private readonly redis: Redis) {}

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, options: SetOptions = {}): Promise<boolean> {
    const args: Array<string | number> = [];
    if (options.ttlMs) args.push('PX', options.ttlMs);
    if (options.ifNotExists) args.push('NX');
    const result = await (
      this.redis as unknown as {
        set(key: string, value: string, ...args: Array<string | number>): Promise<string | null>;
      }
    ).set(key, value, ...args);
    return result === 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return this.redis.del(...keys);
  }

  async incrBy(key: string, amount: number, ttlMs?: number): Promise<number> {
    const value = await this.redis.incrby(key, amount);
    if (ttlMs && value === amount) await this.redis.pexpire(key, ttlMs);
    return value;
  }

  async ttl(key: string): Promise<number> {
    return this.redis.ttl(key);
  }

  /** SCAN statt KEYS: blockiert den Redis-Server nicht (Regel 42). */
  async keys(pattern: string): Promise<string[]> {
    const found: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 250);
      cursor = next;
      found.push(...batch);
    } while (cursor !== '0');
    return found;
  }

  async tokenBucket(key: string, limit: number, windowMs: number, cost = 1): Promise<TokenBucketResult> {
    const [allowed, remaining, resetAfterMs] = (await this.redis.eval(
      TOKEN_BUCKET_SCRIPT,
      1,
      key,
      limit,
      windowMs,
      cost,
    )) as [number, number, number];
    return { allowed: allowed === 1, remaining: Math.max(0, remaining), resetAfterMs };
  }

  async slidingWindowAdd(key: string, member: string, now: number, windowMs: number): Promise<number> {
    return (await this.redis.eval(SLIDING_WINDOW_SCRIPT, 1, key, member, now, windowMs)) as number;
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.redis.publish(channel, message);
  }

  async subscribe(channel: string, handler: (message: string) => void): Promise<() => Promise<void>> {
    this.subscriber ??= this.redis.duplicate();
    await this.subscriber.subscribe(channel);
    const listener = (incoming: string, message: string): void => {
      if (incoming === channel) handler(message);
    };
    this.subscriber.on('message', listener);
    return async () => {
      this.subscriber?.off('message', listener);
      await this.subscriber?.unsubscribe(channel);
    };
  }

  async ping(): Promise<boolean> {
    return (await this.redis.ping()) === 'PONG';
  }

  async close(): Promise<void> {
    await this.subscriber?.quit().catch(() => undefined);
    await this.redis.quit().catch(() => undefined);
  }
}
