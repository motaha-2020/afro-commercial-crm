import { NextRequest, NextResponse } from 'next/server';
import { apiFetch, type ApiError } from '@/lib/api';
import { ACCESS_COOKIE } from '@/lib/session';

/**
 * Lists accounts for pickers that need one — the relationship form's
 * counterparty list today. The query string is forwarded so the API keeps
 * doing the filtering, scoping and paging; the caller's scope still applies,
 * so this is not a way to enumerate accounts somebody cannot see.
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 });

  const query = req.nextUrl.search;
  try {
    return NextResponse.json(await apiFetch(`/accounts${query}`, { token }));
  } catch (err) {
    const e = err as ApiError;
    return NextResponse.json(e, { status: e.statusCode ?? 502 });
  }
}

/** Creates an account on the caller's behalf; the token stays server-side. */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 });

  try {
    const created = await apiFetch('/accounts', {
      method: 'POST',
      token,
      body: JSON.stringify(await req.json()),
    });
    return NextResponse.json(created);
  } catch (err) {
    // The API's validation messages name the offending field; a generic
    // failure here would throw away the only useful part.
    const e = err as ApiError;
    return NextResponse.json(e, { status: e.statusCode ?? 502 });
  }
}
