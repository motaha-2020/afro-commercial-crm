import { NextRequest, NextResponse } from 'next/server';
import { apiFetch, type ApiError } from '@/lib/api';
import { ACCESS_COOKIE } from '@/lib/session';

/**
 * Records the human Bid/No-Bid decision. The API rejects an override of its
 * suggestion without a rationale, and that message is passed straight through
 * so the form can ask for one.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  try {
    const result = await apiFetch(`/bid-assessments/${id}/decision`, {
      method: 'POST',
      token,
      body: JSON.stringify(body),
    });
    return NextResponse.json(result);
  } catch (err) {
    const e = err as ApiError;
    return NextResponse.json(e, { status: e.statusCode ?? 502 });
  }
}
