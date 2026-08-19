import { NextRequest, NextResponse } from 'next/server';
import { apiFetch, type ApiError } from '@/lib/api';
import { ACCESS_COOKIE } from '@/lib/session';

/** Runs a report over chosen metrics. The scope filter stays the caller's. */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 });

  const codes = req.nextUrl.searchParams.get('codes') ?? '';
  try {
    return NextResponse.json(
      await apiFetch(`/metrics/report?codes=${encodeURIComponent(codes)}`, { token }),
    );
  } catch (err) {
    const e = err as ApiError;
    return NextResponse.json(e, { status: e.statusCode ?? 502 });
  }
}
