import { NextRequest, NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api';
import { ACCESS_COOKIE } from '@/lib/session';

/**
 * Marks notifications read on behalf of the browser. The access token is in an
 * httpOnly cookie, so the client cannot call the API directly — this route
 * forwards it server-side. With no id, everything unread is cleared.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 });

  const { id } = (await req.json().catch(() => ({}))) as { id?: string };

  try {
    await apiFetch(id ? `/notifications/${id}/read` : '/notifications/read-all', {
      method: 'POST',
      token,
    });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ message: 'Could not update notifications' }, { status: 502 });
  }
}
