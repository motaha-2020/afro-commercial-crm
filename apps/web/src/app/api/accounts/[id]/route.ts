import { NextRequest, NextResponse } from 'next/server';
import { apiFetch, type ApiError } from '@/lib/api';
import { ACCESS_COOKIE } from '@/lib/session';

/** Edits the customer's own facts; the token stays server-side. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 });
  const { id } = await params;
  try {
    return NextResponse.json(
      await apiFetch(`/accounts/${id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify(await req.json()),
      }),
    );
  } catch (err) {
    // The API names the offending field, and refuses a credit change by the
    // wrong hands with the rule that stopped it. Both are the useful part.
    const e = err as ApiError;
    return NextResponse.json(e, { status: e.statusCode ?? 502 });
  }
}
