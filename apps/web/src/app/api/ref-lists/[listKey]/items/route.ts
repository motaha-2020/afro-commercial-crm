import { NextRequest, NextResponse } from 'next/server';
import { apiFetch, type ApiError } from '@/lib/api';
import { ACCESS_COOKIE } from '@/lib/session';

/** Adds a value to a list. The API refuses on lists that do not accept new ones. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ listKey: string }> },
) {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 });
  const { listKey } = await params;
  try {
    return NextResponse.json(
      await apiFetch(`/ref-lists/${listKey}/items`, {
        method: 'POST',
        token,
        body: JSON.stringify(await req.json()),
      }),
    );
  } catch (err) {
    const e = err as ApiError;
    return NextResponse.json(e, { status: e.statusCode ?? 502 });
  }
}
