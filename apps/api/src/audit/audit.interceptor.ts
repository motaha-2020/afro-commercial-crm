import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { AuditAction } from '@prisma/client';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { AuditService } from './audit.service';
import { wasAudited } from '../common/request-context';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * The safety net under the audit trail.
 *
 * Services record what actually changed, field by field — that is the entry an
 * auditor wants. But "every state-changing operation lands in AuditLog" cannot
 * depend on every future developer remembering to call AuditService. So this
 * interceptor watches every successful mutating request and, if nothing claimed
 * it, writes an envelope entry: who, what route, which entity, which request id.
 *
 * A gap in the trail is a governance failure; a slightly coarse entry is not.
 */

const METHOD_ACTIONS: Record<string, AuditAction> = {
  POST: 'CREATE',
  PUT: 'UPDATE',
  PATCH: 'UPDATE',
  DELETE: 'SOFT_DELETE',
};

/**
 * Route segment to entity name. Anything unmapped falls back to the segment
 * itself so a new module is logged under a readable name from its first commit
 * rather than silently as "unknown".
 */
const ENTITY_BY_SEGMENT: Record<string, string> = {
  accounts: 'Account',
  opportunities: 'Opportunity',
  contacts: 'Contact',
  leads: 'Lead',
  documents: 'Document',
  notifications: 'Notification',
  auth: 'Session',
  governance: 'Governance',
};

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const action = METHOD_ACTIONS[req.method];
    if (!action) return next.handle();

    return next.handle().pipe(
      tap((body) => {
        // Only successful responses reach here; a rejected request is a failed
        // attempt, and those are logged by the exception filter, not as changes.
        if (wasAudited()) return;

        const { entityType, entityId } = this.identify(req, body);
        void this.audit.record({
          entityType,
          entityId,
          action,
          userId: req.user?.id,
          after: { route: `${req.method} ${req.originalUrl ?? req.url}` },
        });
      }),
    );
  }

  /**
   * Best-effort identification, in order of reliability: an id in the response
   * body, then an `:id` route parameter, then the route itself — an entry
   * pointing at a route is still an entry.
   */
  private identify(
    req: Request,
    body: unknown,
  ): { entityType: string; entityId: string } {
    const path = (req.route?.path ?? req.originalUrl ?? req.url ?? '') as string;
    const segments = path.split('?')[0].split('/').filter(Boolean);
    // Strip the global 'api' prefix when the full URL is what we ended up with.
    const first = segments[0] === 'api' ? segments[1] : segments[0];
    const entityType = first ? (ENTITY_BY_SEGMENT[first] ?? first) : 'Unknown';

    const bodyId =
      body && typeof body === 'object' && 'id' in body
        ? String((body as { id: unknown }).id)
        : undefined;

    const routeId = req.params?.id;

    return {
      entityType,
      entityId: bodyId ?? (typeof routeId === 'string' ? routeId : path),
    };
  }
}
