import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { getRequestContext } from './request-context';

/**
 * One access line per request: method, path, status, duration, request id.
 *
 * Failures are logged by the exception filter, so this only reports the ones
 * that completed — together they cover every request exactly once. Health
 * probes are skipped; a container orchestrator polling every few seconds would
 * otherwise be most of the log volume.
 */
@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const path = req.originalUrl ?? req.url;
    if (path.startsWith('/api/health')) return next.handle();

    const startedAt = Date.now();

    return next.handle().pipe(
      tap(() => {
        const res = http.getResponse<Response>();
        const ctx = getRequestContext();
        this.logger.log(
          `${req.method} ${path} ${res.statusCode} ${Date.now() - startedAt}ms [${ctx?.requestId ?? '-'}]`,
        );
      }),
    );
  }
}
