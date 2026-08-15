import { NextRequest, NextResponse } from 'next/server';
import { API_URL } from '@/lib/api';
import { ACCESS_COOKIE } from '@/lib/session';

/**
 * Hands back the template file itself rather than JSON, so the link can be a
 * plain anchor the browser saves. apiFetch is not used for exactly that reason:
 * it parses every reply as JSON, and this one is a spreadsheet.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ resource: string }> },
) {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 });

  const { resource } = await params;
  const res = await fetch(`${API_URL}/api/imports/${resource}/template`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!res.ok) {
    return NextResponse.json({ message: 'Could not build the template' }, { status: res.status });
  }

  return new NextResponse(await res.text(), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${resource}-template.csv"`,
    },
  });
}
