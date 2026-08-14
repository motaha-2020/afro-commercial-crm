import { NextRequest, NextResponse } from 'next/server';
import { apiFetch, type ApiError } from '@/lib/api';
import { ACCESS_COOKIE } from '@/lib/session';

/** Lists users. The access token is forwarded server-side, never exposed. */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 });
  try {
    return NextResponse.json(await apiFetch('/users', { token }));
  } catch (err) {
    const e = err as ApiError;
    return NextResponse.json(e, { status: e.statusCode ?? 502 });
  }
}

/** Creates a user and returns the one-time temporary password. */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 });
  try {
    const created = await apiFetch('/users', {
      method: 'POST',
      token,
      body: JSON.stringify(await req.json()),
    });
    return NextResponse.json(created);
  } catch (err) {
    const e = err as ApiError;
    return NextResponse.json(e, { status: e.statusCode ?? 502 });
  }
}
