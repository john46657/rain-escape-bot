import { TimeoutError } from './errors.js';
import { sleep } from './time.js';

export interface RetryOptions {
  attempts?: number;
  /** Basis-Delay in ms; waechst exponentiell. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Zufaellige Streuung (0..1), verhindert Thundering Herd. */
  jitter?: number;
  /** Entscheidet, ob ein Fehler erneut versucht wird. */
  retryOn?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  signal?: AbortSignal;
}

/** Fuehrt eine Operation mit exponentiellem Backoff und Jitter aus. */
export async function retry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    attempts = 3, baseDelayMs = 250, maxDelayMs = 10_000, jitter = 0.2,
    retryOn = () => true, onRetry, signal,
  } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (signal?.aborted) throw signal.reason ?? new Error('Abgebrochen');
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !retryOn(error, attempt)) break;
      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delay = Math.round(exponential * (1 - jitter + Math.random() * jitter * 2));
      onRetry?.(error, attempt, delay);
      await sleep(delay);
    }
  }
  throw lastError;
}

/** Begrenzt die Laufzeit eines Promise. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, operation = 'operation'): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(operation, ms)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Circuit Breaker: schuetzt Upstreams (Roblox/Discord) vor Ueberlastung
 * und verhindert, dass ein haengender Dienst den Bot blockiert.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private halfOpen = false;

  constructor(
    private readonly threshold = 5,
    private readonly cooldownMs = 30_000,
  ) {}

  get state(): 'closed' | 'open' | 'half-open' {
    if (this.failures < this.threshold) return 'closed';
    if (Date.now() - this.openedAt > this.cooldownMs) return 'half-open';
    return 'open';
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    const state = this.state;
    if (state === 'open') {
      throw new Error('Circuit Breaker offen — Upstream vorruebergehend deaktiviert');
    }
    this.halfOpen = state === 'half-open';
    try {
      const result = await operation();
      this.reset();
      return result;
    } catch (error) {
      this.failures++;
      if (this.failures >= this.threshold && !this.halfOpen) this.openedAt = Date.now();
      if (this.halfOpen) this.openedAt = Date.now();
      throw error;
    }
  }

  reset(): void {
    this.failures = 0;
    this.openedAt = 0;
    this.halfOpen = false;
  }
}
