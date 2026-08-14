import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { getRequestContext } from './request-context';

/**
 * One error shape for the whole API, and one place that logs failures.
 *
 * 5xx are logged with a stack; 4xx are expected client errors and logged at
 * debug so they do not drown real incidents. Every response carries the request
 * id so a user-reported error can be traced to its log line.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const ctx = getRequestContext();
    const requestId = ctx?.requestId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = { message: 'Internal server error' };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      body =
        typeof response === 'string'
          ? { message: response }
          : (response as Record<string, unknown>);
    }

    if (status >= 500) {
      this.logger.error(
        `${status} [${requestId}] ${String((body as { message?: unknown }).message ?? exception)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.debug(`${status} [${requestId}] ${JSON.stringify(body)}`);
    }

    res.status(status).json({ ...body, statusCode: status, requestId });
  }
}
