import type { Role } from '@prisma/client';

/**
 * Who may read the trail.
 *
 * Reading who touched a record is itself sensitive — it exposes staff
 * behaviour, not just data — so it is narrower than the data the entries
 * describe.
 *
 * Declared here rather than inline on the controller because the AI agents
 * call the service in-process and never pass through the HTTP guard. Two
 * copies of this list would drift, and the copy that drifts wider is a leak
 * nobody notices.
 */
export const AUDIT_READER_ROLES: readonly Role[] = [
  'OWNER_BOARD',
  'CEO',
  'SALES_DIRECTOR',
  'FINANCE',
  'LEGAL',
  'SYSTEM_ADMIN',
];

export function canReadAudit(roles: readonly { role: Role }[]): boolean {
  return roles.some((r) => AUDIT_READER_ROLES.includes(r.role));
}
