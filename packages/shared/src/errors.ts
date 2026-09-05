/**
 * Zentrale Fehlerhierarchie fuer NEXUS.
 *
 * Jeder Fehler traegt einen stabilen `code`, einen HTTP-Status (fuer die API)
 * und ein Flag `expected`. Erwartete Fehler (Validierung, fehlende Rechte)
 * werden als WARN geloggt, unerwartete als ERROR inkl. Stacktrace.
 */
export type ErrorCode =
  | 'INTERNAL'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'PRECONDITION_FAILED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'TIMEOUT'
  | 'REPLAY_DETECTED'
  | 'SIGNATURE_INVALID'
  | 'INSUFFICIENT_FUNDS'
  | 'FEATURE_LOCKED';

export interface NexusErrorOptions {
  code?: ErrorCode;
  status?: number;
  expected?: boolean;
  /** Zusatzkontext fuer Logs. Darf keine Secrets enthalten. */
  meta?: Record<string, unknown>;
  cause?: unknown;
  /** i18n-Key fuer eine benutzerfreundliche Meldung. */
  i18nKey?: string;
}

export class NexusError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly expected: boolean;
  readonly meta: Record<string, unknown>;
  readonly i18nKey?: string;

  constructor(message: string, options: NexusErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = options.code ?? 'INTERNAL';
    this.status = options.status ?? 500;
    this.expected = options.expected ?? false;
    this.meta = options.meta ?? {};
    this.i18nKey = options.i18nKey;
    Error.captureStackTrace?.(this, new.target);
  }

  toJSON(): Record<string, unknown> {
    return { name: this.name, code: this.code, status: this.status, message: this.message, meta: this.meta };
  }
}

export class ValidationError extends NexusError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super(message, { code: 'VALIDATION', status: 400, expected: true, meta });
  }
}

export class NotFoundError extends NexusError {
  constructor(resource: string, meta?: Record<string, unknown>) {
    super(`${resource} wurde nicht gefunden`, { code: 'NOT_FOUND', status: 404, expected: true, meta });
  }
}

export class ConflictError extends NexusError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super(message, { code: 'CONFLICT', status: 409, expected: true, meta });
  }
}

export class UnauthorizedError extends NexusError {
  constructor(message = 'Authentifizierung erforderlich', meta?: Record<string, unknown>) {
    super(message, { code: 'UNAUTHORIZED', status: 401, expected: true, meta });
  }
}

export class ForbiddenError extends NexusError {
  constructor(message = 'Keine Berechtigung', meta?: Record<string, unknown>) {
    super(message, { code: 'FORBIDDEN', status: 403, expected: true, meta });
  }
}

export class RateLimitError extends NexusError {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number, meta?: Record<string, unknown>) {
    super('Rate Limit erreicht', { code: 'RATE_LIMITED', status: 429, expected: true, meta });
    this.retryAfterMs = retryAfterMs;
  }
}

export class PreconditionError extends NexusError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super(message, { code: 'PRECONDITION_FAILED', status: 412, expected: true, meta });
  }
}

export class UpstreamError extends NexusError {
  constructor(service: string, message: string, meta?: Record<string, unknown>) {
    super(`[${service}] ${message}`, {
      code: 'UPSTREAM_UNAVAILABLE',
      status: 502,
      expected: true,
      meta: { service, ...meta },
    });
  }
}

export class TimeoutError extends NexusError {
  constructor(operation: string, ms: number) {
    super(`Zeitueberschreitung nach ${ms}ms: ${operation}`, {
      code: 'TIMEOUT',
      status: 504,
      expected: true,
      meta: { operation, ms },
    });
  }
}

export class FeatureLockedError extends NexusError {
  constructor(feature: string, requiredTier: string) {
    super(`Feature "${feature}" erfordert Tier ${requiredTier}`, {
      code: 'FEATURE_LOCKED',
      status: 402,
      expected: true,
      meta: { feature, requiredTier },
    });
  }
}

export function isNexusError(value: unknown): value is NexusError {
  return value instanceof NexusError;
}

/** Wandelt beliebige Werte in einen NexusError um (fuer catch-Bloecke). */
export function toNexusError(value: unknown): NexusError {
  if (isNexusError(value)) return value;
  if (value instanceof Error) {
    return new NexusError(value.message, { cause: value, meta: { originalName: value.name } });
  }
  return new NexusError('Unbekannter Fehler', { meta: { value: String(value) } });
}
