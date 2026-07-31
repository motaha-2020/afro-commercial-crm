import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request ambient data. Carried through AsyncLocalStorage so any service —
 * audit, logging — can reach the acting user, client address and request id
 * without every method signature having to thread them through by hand.
 */
export interface RequestContext {
  requestId: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Late-binds the user id once authentication has resolved it. */
export function setContextUser(userId: string): void {
  const store = storage.getStore();
  if (store) store.userId = userId;
}
