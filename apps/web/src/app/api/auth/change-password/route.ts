import { NextRequest, NextResponse } from 'next/server';
import { apiFetch, type ApiError } from '@/lib/api';
import { ACCESS_COOKIE } from '@/lib/session';

/** Changes the signed-in user's own password. */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 });
  try {
    const res = await apiFetch('/auth/change-password', {
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
