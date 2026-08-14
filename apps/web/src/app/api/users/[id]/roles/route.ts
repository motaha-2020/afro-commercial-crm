import { NextRequest, NextResponse } from 'next/server';
import { apiFetch, type ApiError } from '@/lib/api';
import { ACCESS_COOKIE } from '@/lib/session';

/** Grants a role at a scope to a user. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 });
  const { id } = await params;
  try {
    const res = await apiFetch(`/users/${id}/roles`, {
      method: 'POST',
      token,
      body: JSON.stringify(await req.json()),
    });
    return NextResponse.json(res);
  } catch (err) {
    const e = err as ApiError;
    return NextResponse.json(e, { status: e.statusCode ?? 502 });
  }
}
