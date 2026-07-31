/**
 * Roles and data visibility.
 *
 * The spec specifies a hybrid model: RBAC + ABAC + record-level + field-level +
 * action-level. Phase A implements RBAC and record-level data scope; the shapes
 * here are designed so ABAC attributes and field-level masking slot in later
 * without a rewrite.
 */

export const ROLES = [
  'OWNER_BOARD',
  'CEO',
  'SALES_DIRECTOR',
  'ACCOUNT_MANAGER',
  'PRESALES',
  'ESTIMATION',
  'PROCUREMENT',
  'FINANCE',
  'OPERATIONS',
  'LEGAL',
  'PROJECT_MANAGER',
  'SYSTEM_ADMIN',
] as const;

export type Role = (typeof ROLES)[number];

/**
 * Six levels of record visibility, from narrowest to widest. A user's effective
 * scope is the widest granted by any of their roles.
 */
export const DATA_SCOPES = [
  'OWN',
  'TEAM',
  'BUSINESS_UNIT',
  'COUNTRY',
  'LEGAL_ENTITY',
  'GROUP',
] as const;

export type DataScope = (typeof DATA_SCOPES)[number];

export const DATA_SCOPE_RANK: Record<DataScope, number> = {
  OWN: 0,
  TEAM: 1,
  BUSINESS_UNIT: 2,
  COUNTRY: 3,
  LEGAL_ENTITY: 4,
  GROUP: 5,
};

export function widestScope(scopes: readonly DataScope[]): DataScope {
  return scopes.reduce<DataScope>(
    (widest, s) => (DATA_SCOPE_RANK[s] > DATA_SCOPE_RANK[widest] ? s : widest),
    'OWN',
  );
}

/**
 * Data sensitivity classification. Drives field-level masking in Phase B and
 * governs what may be sent to external AI providers.
 */
export const SENSITIVITY_LEVELS = [
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'HIGHLY_CONFIDENTIAL',
  'RESTRICTED',
] as const;

export type SensitivityLevel = (typeof SENSITIVITY_LEVELS)[number];

export const PERMISSION_ACTIONS = [
  'CREATE',
  'READ',
  'UPDATE',
  'DELETE',
  'APPROVE',
  'SUBMIT',
  'EXPORT',
] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];
