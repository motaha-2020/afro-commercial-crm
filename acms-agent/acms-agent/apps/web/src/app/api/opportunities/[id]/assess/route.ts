import { NextRequest, NextResponse } from 'next/server';
import { apiFetch, type ApiError } from '@/lib/api';
import { ACCESS_COOKIE } from '@/lib/session';

/** Forwards a Bid/No-Bid assessment; the token never leaves the server. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  try {
    const result = await apiFetch(`/opportunities/${id}/bid-assessment`, {
      method: 'POST',
      token,
      body: JSON.stringify(body),
    });
    return NextResponse.json(result);
  } catch (err) {
    // Pass the API's own message through — it explains which factor or rating
    // was rejected, which a generic failure would throw away.
    const e = err as ApiError;
    return NextResponse.json(e, { status: e.statusCode ?? 502 });
  }
}
