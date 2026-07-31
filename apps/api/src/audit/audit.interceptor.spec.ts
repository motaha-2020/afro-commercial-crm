import { lastValueFrom, of } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { AuditInterceptor } from './audit.interceptor';
import { markAudited, runWithContext } from '../common/request-context';

function contextFor(req: Record<string, unknown>): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const handlerReturning = (body: unknown): CallHandler => ({
  handle: () => of(body),
});

describe('AuditInterceptor', () => {
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const interceptor = new AuditInterceptor(audit as never);

  beforeEach(() => audit.record.mockClear());

  it('ignores reads', async () => {
    const ctx = contextFor({ method: 'GET', url: '/api/accounts', params: {} });
    await lastValueFrom(interceptor.intercept(ctx, handlerReturning([])));
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('logs a mutation that no service claimed', async () => {
    const ctx = contextFor({
      method: 'POST',
      url: '/api/accounts',
      originalUrl: '/api/accounts',
      params: {},
      user: { id: 'user-9' },
    });

    await runWithContext({ requestId: 'req-1' }, () =>
      lastValueFrom(interceptor.intercept(ctx, handlerReturning({ id: 'acc-7' }))),
    );

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'Account',
        entityId: 'acc-7',
        action: 'CREATE',
        userId: 'user-9',
      }),
    );
  });

  it('stays quiet when the service already wrote a detailed entry', async () => {
    const ctx = contextFor({
      method: 'PATCH',
      url: '/api/accounts/acc-7',
      originalUrl: '/api/accounts/acc-7',
      params: { id: 'acc-7' },
    });

    await runWithContext({ requestId: 'req-2' }, async () => {
      markAudited();
      await lastValueFrom(interceptor.intercept(ctx, handlerReturning({ id: 'acc-7' })));
    });

    expect(audit.record).not.toHaveBeenCalled();
  });

  it('falls back to the route id when the response carries no entity', async () => {
    const ctx = contextFor({
      method: 'DELETE',
      url: '/api/opportunities/opp-3',
      originalUrl: '/api/opportunities/opp-3',
      params: { id: 'opp-3' },
    });

    await runWithContext({ requestId: 'req-3' }, () =>
      lastValueFrom(interceptor.intercept(ctx, handlerReturning({ success: true }))),
    );

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'Opportunity',
        entityId: 'opp-3',
        action: 'SOFT_DELETE',
      }),
    );
  });
});
