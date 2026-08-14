import type { DataScope, Role } from '@prisma/client';

export interface RoleAssignment {
  role: Role;
  scope: DataScope;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  orgUnitId: string;
  roles: RoleAssignment[];
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  orgUnitId: string;
  roles: RoleAssignment[];
}
