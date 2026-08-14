import { NextRequest, NextResponse } from 'next/server';
import { apiFetch, type ApiError } from '@/lib/api';
import { ACCESS_COOKIE } from '@/lib/session';

/** Revokes a single role from a user. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; role: string }> },
) {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 });
  const { id, role } = await params;
  try {
    const res = await apiFetch(`/users/${id}/roles/${role}`, {
      method: 'DELETE',
      token,
    });
    return NextResponse.json(res ?? { revoked: role });
  } catch (err) {
    const e = err as ApiError;
    return NextResponse.json(e, { status: e.statusCode ?? 502 });
  }
}
