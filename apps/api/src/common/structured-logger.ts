import { ConsoleLogger, LoggerService, LogLevel } from '@nestjs/common';
import { getRequestContext } from './request-context';

const LEVELS: LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose'];

/**
 * One JSON line per log event, carrying the request id and acting user.
 *
 * The point is joinability: a user reports an error showing request id X, and
 * that id appears on the HTTP access line, on every log written while handling
 * it, and in the AuditLog row it produced. Pretty console output stays the
 * default for local work — set LOG_FORMAT=json (or run in production) for the
 * machine-readable form.
 */
export class StructuredLogger extends ConsoleLogger implements LoggerService {
  private readonly json: boolean;
  private readonly threshold: number;

  constructor() {
    super();
    this.json =
      (process.env.LOG_FORMAT ?? (process.env.NODE_ENV === 'production' ? 'json' : 'pretty')) ===
      'json';
    const level = (process.env.LOG_LEVEL ?? 'log') as LogLevel;
    this.threshold = LEVELS.indexOf(level) === -1 ? 2 : LEVELS.indexOf(level);
  }

  private enabled(level: LogLevel): boolean {
    return LEVELS.indexOf(level) <= this.threshold;
  }

  private emit(level: LogLevel, message: unknown, context?: string, stack?: string): void {
    if (!this.enabled(level)) return;

    if (!this.json) {
      if (level === 'error') super.error(message as string, stack, context);
      else if (level === 'warn') super.warn(message as string, context);
      else if (level === 'debug') super.debug(message as string, context);
      else if (level === 'verbose') super.verbose(message as string, context);
      else super.log(message as string, context);
      return;
    }

    const ctx = getRequestContext();
    process.stdout.write(
      `${JSON.stringify({
        time: new Date().toISOString(),
        level,
        context: context ?? undefined,
        message: typeof message === 'string' ? message : JSON.stringify(message),
        requestId: ctx?.requestId,
        userId: ctx?.userId,
        stack,
      })}\n`,
    );
  }

  log(message: unknown, context?: string): void {
    this.emit('log', message, context);
  }

  error(message: unknown, stack?: string, context?: string): void {
    this.emit('error', message, context, stack);
  }

  warn(message: unknown, context?: string): void {
    this.emit('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.emit('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.emit('verbose', message, context);
  }
}
