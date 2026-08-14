import { NextRequest, NextResponse } from 'next/server';
import { apiFetch, type ApiError } from '@/lib/api';
import { ACCESS_COOKIE } from '@/lib/session';

/** Soft delete. The API refuses on a lead that became an opportunity. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 });
  const { id } = await params;
  try {
    return NextResponse.json(await apiFetch(`/leads/${id}`, { method: 'DELETE', token }));
  } catch (err) {
    const e = err as ApiError;
    return NextResponse.json(e, { status: e.statusCode ?? 502 });
  }
}

/** Edits the lead. The API refuses once it is closed. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 });
  const { id } = await params;
  try {
    return NextResponse.json(
      await apiFetch(`/leads/${id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify(await req.json()),
      }),
    );
  } catch (err) {
    const e = err as ApiError;
    return NextResponse.json(e, { status: e.statusCode ?? 502 });
  }
}
