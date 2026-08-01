import { NextRequest, NextResponse } from 'next/server';
import { API_URL } from '@/lib/api';
import { ACCESS_COOKIE } from '@/lib/session';

/**
 * Proxies the binary download so it stays behind the same httpOnly-cookie
 * auth as everything else — a direct link to the API would need the token
 * exposed to the browser.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 });

  const { id } = await params;
  const versionId = req.nextUrl.searchParams.get('versionId');
  const qs = versionId ? `?versionId=${encodeURIComponent(versionId)}` : '';

  const res = await fetch(`${API_URL}/api/documents/${id}/download${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok || !res.body) {
    return NextResponse.json({ message: 'Download failed' }, { status: res.status || 502 });
  }

  const headers = new Headers();
  const contentType = res.headers.get('content-type');
  const disposition = res.headers.get('content-disposition');
  const checksum = res.headers.get('x-checksum-sha256');
  if (contentType) headers.set('Content-Type', contentType);
  if (disposition) headers.set('Content-Disposition', disposition);
  if (checksum) headers.set('x-checksum-sha256', checksum);

  return new NextResponse(res.body, { status: 200, headers });
}
