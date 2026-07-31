import { cookies } from 'next/headers';

export const ACCESS_COOKIE = 'acms_access';
export const REFRESH_COOKIE = 'acms_refresh';

export interface SessionUser {
  id: string;
  email: string;
  orgUnitId: string;
  roles: { role: string; scope: string }[];
}

/** Reads the access token from the request cookies (server components only). */
export async function getAccessToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(ACCESS_COOKIE)?.value;
}

/** Decodes the JWT payload without verifying — server trusts it because it set
 *  the cookie itself; the API re-verifies on every call. */
export function decodeToken(token: string): SessionUser | null {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64').toString('utf8'),
    );
    return {
      id: payload.sub,
      email: payload.email,
      orgUnitId: payload.orgUnitId,
      roles: payload.roles ?? [],
    };
  } catch {
    return null;
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = await getAccessToken();
  return token ? decodeToken(token) : null;
}
