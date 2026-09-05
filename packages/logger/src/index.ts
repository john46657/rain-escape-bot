/**
 * Strukturiertes JSON-Logging fuer NEXUS.
 *
 * Ebenen: DEBUG < INFO < WARN < ERROR, dazu die fachlichen Kanaele
 * SECURITY und AUDIT (Regel 41). SECURITY/AUDIT werden nie unterdrueckt,
 * da sie revisionsrelevant sind.
 */
import { inspect } from 'node:util';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'security', 'audit'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  security: 50,
  audit: 50,
};

export interface LogContext extends Record<string, unknown> {
  guildId?: string;
  userId?: string;
  robloxUserId?: string;
  gameId?: string;
  requestId?: string;
  module?: string;
  shard?: number;
}

export interface LoggerOptions {
  name: string;
  level?: LogLevel;
  pretty?: boolean;
  context?: LogContext;
  /** Zusaetzliche Senke, z. B. Persistenz von SECURITY/AUDIT-Eintraegen. */
  sink?: (entry: LogEntry) => void;
}

export interface LogEntry {
  time: string;
  level: LogLevel;
  name: string;
  msg: string;
  context: LogContext;
  err?: { name: string; message: string; stack?: string; code?: string };
}

const SENSITIVE = /^(.*(token|secret|password|apikey|api_key|authorization|signature|cookie).*)$/i;

function sanitize(context: LogContext): LogContext {
  const output: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    output[key] = SENSITIVE.test(key) ? '[redacted]' : value;
  }
  return output;
}

const COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  security: '\x1b[35m',
  audit: '\x1b[32m',
};

export class Logger {
  private readonly name: string;
  private readonly level: LogLevel;
  private readonly pretty: boolean;
  private readonly context: LogContext;
  private readonly sink?: (entry: LogEntry) => void;

  constructor(options: LoggerOptions) {
    this.name = options.name;
    this.level = options.level ?? 'info';
    this.pretty = options.pretty ?? false;
    this.context = options.context ?? {};
    this.sink = options.sink;
  }

  /** Erzeugt einen Logger mit zusaetzlichem, festem Kontext. */
  child(context: LogContext, name?: string): Logger {
    return new Logger({
      name: name ?? this.name,
      level: this.level,
      pretty: this.pretty,
      context: { ...this.context, ...context },
      sink: this.sink,
    });
  }

  debug(msg: string, context?: LogContext): void {
    this.write('debug', msg, context);
  }
  info(msg: string, context?: LogContext): void {
    this.write('info', msg, context);
  }
  warn(msg: string, context?: LogContext): void {
    this.write('warn', msg, context);
  }

  error(msg: string, error?: unknown, context?: LogContext): void {
    this.write('error', msg, context, error);
  }

  /** Sicherheitsrelevante Ereignisse (Anti-Nuke, Signaturfehler, Lockdown). */
  security(msg: string, context?: LogContext): void {
    this.write('security', msg, context);
  }

  /** Administrative Aktionen (Regel 34). */
  audit(msg: string, context?: LogContext): void {
    this.write('audit', msg, context);
  }

  private write(level: LogLevel, msg: string, context?: LogContext, error?: unknown): void {
    if (SEVERITY[level] < SEVERITY[this.level]) return;

    const entry: LogEntry = {
      time: new Date().toISOString(),
      level,
      name: this.name,
      msg,
      context: sanitize({ ...this.context, ...context }),
    };

    if (error !== undefined) {
      const err = error instanceof Error ? error : new Error(inspect(error));
      entry.err = {
        name: err.name,
        message: err.message,
        stack: err.stack,
        code: (err as { code?: string }).code,
      };
    }

    this.sink?.(entry);

    const stream = SEVERITY[level] >= 40 ? process.stderr : process.stdout;
    stream.write(this.pretty ? this.format(entry) : `${JSON.stringify(entry)}\n`);
  }

  private format(entry: LogEntry): string {
    const color = COLORS[entry.level];
    const reset = '\x1b[0m';
    const time = entry.time.slice(11, 23);
    const ctx = Object.keys(entry.context).length
      ? ` \x1b[90m${Object.entries(entry.context)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(' ')}${reset}`
      : '';
    const err = entry.err ? `\n${entry.err.stack ?? entry.err.message}` : '';
    return `${color}${entry.level.toUpperCase().padEnd(8)}${reset}\x1b[90m${time}${reset} \x1b[1m${entry.name}${reset} ${entry.msg}${ctx}${err}\n`;
  }
}

export function createLogger(name: string, options: Partial<LoggerOptions> = {}): Logger {
  return new Logger({
    name,
    level: (process.env.LOG_LEVEL as LogLevel) ?? 'info',
    pretty: options.pretty ?? process.env.LOG_PRETTY === 'true',
    ...options,
  });
}

/** Root-Logger; Anwendungen leiten daraus Child-Logger ab. */
export const logger = createLogger('nexus');
