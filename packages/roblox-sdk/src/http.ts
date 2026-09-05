/**
 * HTTP-Schicht fuer die oeffentlichen Roblox-Web-APIs und Open Cloud.
 *
 * Eigenschaften (Regel 40/42):
 *  - Timeout je Anfrage
 *  - Retry mit exponentiellem Backoff nur bei 429/5xx
 *  - Circuit Breaker, damit ein Ausfall nicht den Bot blockiert
 *  - keine Secrets in Logs
 */
import { CircuitBreaker, UpstreamError, retry, withTimeout } from '@nexus/shared';

export interface RobloxHttpOptions {
  timeoutMs?: number;
  attempts?: number;
  apiKey?: string;
  userAgent?: string;
}

export class RobloxHttp {
  private readonly breaker = new CircuitBreaker(6, 30_000);

  constructor(private readonly options: RobloxHttpOptions = {}) {}

  async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    headers.set('user-agent', this.options.userAgent ?? 'NEXUS/1.0 (+https://github.com/nexus)');
    if (this.options.apiKey) headers.set('x-api-key', this.options.apiKey);
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');

    return this.breaker.execute(() =>
      retry(
        async () => {
          const response = await withTimeout(
            fetch(url, { ...init, headers }),
            this.options.timeoutMs ?? 10_000,
            `roblox ${init.method ?? 'GET'} ${new URL(url).pathname}`,
          );

          if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new UpstreamError('roblox', `HTTP ${response.status}`, {
              status: response.status,
              path: new URL(url).pathname,
              body: text.slice(0, 300),
            });
          }
          if (response.status === 204) return undefined as T;
          return (await response.json()) as T;
        },
        {
          attempts: this.options.attempts ?? 3,
          baseDelayMs: 400,
          // Nur transiente Fehler wiederholen — 4xx sind Anwendungsfehler.
          retryOn: (error) => {
            const status = Number((error as { meta?: { status?: number } }).meta?.status ?? 0);
            return status === 0 || status === 429 || status >= 500;
          },
        },
      ),
    );
  }
}
