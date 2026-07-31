import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { runWithContext } from './request-context';

/**
 * Opens a request context for the lifetime of every request. Runs before guards
 * and controllers, so the user id is filled in later (by JwtStrategy) once auth
 * resolves — the id is absent for the brief window before that, which is correct
 * for unauthenticated routes.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId =
      (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
    res.setHeader('x-request-id', requestId);

    runWithContext(
      {
        requestId,
        ipAddress: req.ip,
        userAgent: req.get('user-agent') ?? undefined,
      },
      () => next(),
    );
  }
}
