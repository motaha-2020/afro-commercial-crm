import { NextRequest, NextResponse } from 'next/server';
import { apiFetch, type ApiError } from '@/lib/api';
import { ACCESS_COOKIE } from '@/lib/session';

type Ctx = { params: Promise<{ id: string }> };

/** Who may be added to this bid team, with the roles each of them holds. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 });

  const { id } = await params;
  try {
    return NextResponse.json(
      await apiFetch(`/opportunities/${id}/team/candidates`, { token }),
    );
  } catch (err) {
    const e = err as ApiError;
    return NextResponse.json(e, { status: e.statusCode ?? 502 });
  }
}
