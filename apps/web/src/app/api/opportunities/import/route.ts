import { NextRequest, NextResponse } from 'next/server';
import { apiFetch, type ApiError } from '@/lib/api';
import { ACCESS_COOKIE } from '@/lib/session';

/**
 * Preview and commit share one route, separated by ?mode=. Both forward the
 * whole file: the API validates from scratch each time, so there is nothing
 * here worth holding on to between the two calls.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 });

  const mode = req.nextUrl.searchParams.get('mode') === 'commit' ? 'commit' : 'preview';

  try {
    return NextResponse.json(
      await apiFetch(`/opportunities/import/${mode}`, {
        method: 'POST',
        token,
        body: JSON.stringify(await req.json()),
      }),
    );
  } catch (err) {
    // The API's reply names the offending lines and columns; that detail is the
    // only thing that makes a rejected file fixable.
    const e = err as ApiError;
    return NextResponse.json(e, { status: e.statusCode ?? 502 });
  }
}
