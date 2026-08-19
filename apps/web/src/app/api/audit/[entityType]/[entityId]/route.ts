import { NextRequest, NextResponse } from 'next/server';
import { apiFetch, type ApiError } from '@/lib/api';
import { ACCESS_COOKIE } from '@/lib/session';

type Ctx = { params: Promise<{ entityType: string; entityId: string }> };

/**
 * The trail for one record. Read-only because the trail is: there is no write
 * endpoint behind this, and not even a system administrator edits it.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const { entityType, entityId } = await params;
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 });

  try {
    return NextResponse.json(await apiFetch(`/audit/${entityType}/${entityId}`, { token }));
  } catch (err) {
    const e = err as ApiError;
    return NextResponse.json(e, { status: e.statusCode ?? 502 });
  }
}
