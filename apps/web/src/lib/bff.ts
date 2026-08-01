import { NextRequest, NextResponse } from 'next/server';
import { apiFetch, type ApiError } from './api';
import { ACCESS_COOKIE } from './session';

/**
 * Forwards a write to the API with the caller's token, which lives in an
 * httpOnly cookie and must never reach browser code.
 *
 * The target path is supplied by the route handler, never by the request — a
 * handler that took the path from the client would be an open proxy into the
 * API with someone else's credentials attached.
 *
 * The API's own error body is passed through untouched: its validation messages
 * name the offending field, and a generic failure would throw away the only
 * part a form can act on.
 */
export async function forward(
  req: NextRequest,
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
): Promise<NextResponse> {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 });

  let body: string | undefined;
  if (method !== 'DELETE') {
    // A PATCH with no payload is legitimate (complete, mark read); an empty
    // body would otherwise throw here and turn into a confusing 502.
    body = await req.text().then((text) => text || '{}');
  }

  try {
    const result = await apiFetch(path, { method, token, body });
    return NextResponse.json(result ?? { success: true });
  } catch (err) {
    const e = err as ApiError;
    return NextResponse.json(e, { status: e.statusCode ?? 502 });
  }
}
