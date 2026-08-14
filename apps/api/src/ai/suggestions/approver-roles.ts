import type { Role } from '@prisma/client';

/** Roles allowed to approve or reject an AI-generated suggestion. */
export const AI_APPROVER_ROLES: Role[] = [
  'CEO',
  'SALES_DIRECTOR',
  'OPERATIONS',
  'FINANCE',
  'SYSTEM_ADMIN',
];
