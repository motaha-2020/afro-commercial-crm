import type { Role } from '@prisma/client';

/**
 * Who may set a target.
 *
 * The same separation approval limits keep, for the same reason: a salesperson
 * who can set the number they are measured against is not being measured. It
 * is deliberately narrower than the list of people who can read one.
 */
export const TARGET_AUTHORITY: readonly Role[] = [
  'OWNER_BOARD',
  'CEO',
  'SALES_DIRECTOR',
  'FINANCE',
];

export function maySetTargets(roles: readonly { role: Role }[]): boolean {
  return roles.some((r) => TARGET_AUTHORITY.includes(r.role));
}
