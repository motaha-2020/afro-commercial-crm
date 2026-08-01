/**
 * Thin API client. The access token lives in an httpOnly cookie set by the
 * login route handler, so browser code never touches it directly; requests to
 * our own /bff routes forward it server-side.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface ApiError {
  statusCode: number;
  message: string | string[];
  missingFields?: string[];
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, headers, ...rest } = init;
  const res = await fetch(`${API_URL}/api${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    let body: ApiError;
    try {
      body = (await res.json()) as ApiError;
    } catch {
      body = { statusCode: res.status, message: res.statusText };
    }
    throw body;
  }

  // 204 and empty bodies
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
