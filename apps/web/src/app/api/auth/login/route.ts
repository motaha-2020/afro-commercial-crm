import { NextRequest, NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/session';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export async function POST(req: NextRequest) {
  const { email, password } = (await req.json()) as {
    email?: string;
    password?: string;
  };

  if (!email || !password) {
    return NextResponse.json({ message: 'Email and password required' }, { status: 400 });
  }

  try {
    const tokens = await apiFetch<TokenPair>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    const res = NextResponse.json({ success: true });
    // Secure cookies are only sent back over HTTPS. This deployment serves over
    // plain HTTP on a private tailnet, so defaulting `secure` to NODE_ENV would
    // silently drop the session on every request. Drive it from an explicit env
    // flag instead — set COOKIE_SECURE=true once TLS terminates in front.
    const secure = process.env.COOKIE_SECURE === 'true';
    res.cookies.set(ACCESS_COOKIE, tokens.accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: 60 * 15,
    });
    res.cookies.set(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  } catch {
    // Deliberately generic: never reveal whether the email exists.
    return NextResponse.json({ message: 'Invalid credentials' }, { status: 401 });
  }
}
