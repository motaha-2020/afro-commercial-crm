import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import * as argon2 from 'argon2';
import { DataScope, Role } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateUserDto, GrantRoleDto, UpdateUserDto } from './dto';

/**
 * A generated temporary password shown once. Excludes look-alike characters
 * (0/O, 1/l/I) so it survives being read aloud or copied by hand, and always
 * carries all four character classes so it clears any strength check.
 */
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGIT = '23456789';
const SYMBOL = '!@#$%*?-';

function pick(chars: string): string {
  return chars[randomInt(chars.length)];
}

function generateTempPassword(): string {
  const all = LOWER + UPPER + DIGIT + SYMBOL;
  const required = [pick(LOWER), pick(UPPER), pick(DIGIT), pick(SYMBOL)];
  const rest = Array.from({ length: 10 }, () => pick(all));
  const chars = [...required, ...rest];
  // Fisher–Yates so the required classes are not stuck at the front.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

const publicUser = {
  id: true,
  email: true,
  fullNameAr: true,
  fullNameEn: true,
  jobTitle: true,
  phone: true,
  locale: true,
  isActive: true,
  mustChangePassword: true,
  orgUnitId: true,
  managerId: true,
  lastLoginAt: true,
  createdAt: true,
  orgUnit: { select: { id: true, code: true, nameAr: true, nameEn: true } },
  roles: { select: { role: true, scope: true } },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Everything the create/edit form needs: where a user can sit, and the
   *  roles and visibility scopes that can be granted. */
  async meta() {
    const orgUnits = await this.prisma.organizationUnit.findMany({
      where: { deletedAt: null },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, nameAr: true, nameEn: true, type: true },
    });
    return {
      orgUnits,
      roles: Object.values(Role),
      scopes: Object.values(DataScope),
    };
  }

  async list() {
    return this.prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: publicUser,
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: publicUser,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /**
   * Creates a user with a generated temporary password, returned once. The
   * password is never stored in clear and never logged — only its argon2 hash
   * is persisted, and the account is flagged to force a change on first login.
   */
  async create(actor: AuthenticatedUser, dto: CreateUserDto) {
    const email = dto.email.toLowerCase();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('A user with this email already exists');

    const orgUnit = await this.prisma.organizationUnit.findFirst({
      where: { id: dto.orgUnitId, deletedAt: null },
      select: { id: true },
    });
    if (!orgUnit) throw new BadRequestException('orgUnitId does not match an organization unit');

    if (dto.managerId) {
      const manager = await this.prisma.user.findFirst({
        where: { id: dto.managerId, deletedAt: null },
        select: { id: true },
      });
      if (!manager) throw new BadRequestException('managerId does not match a user');
    }

    if (!dto.roles || dto.roles.length === 0) {
      throw new BadRequestException('A user needs at least one role');
    }
    const seen = new Set<string>();
    for (const r of dto.roles) {
      if (seen.has(r.role)) {
        throw new BadRequestException(`Role ${r.role} is assigned twice`);
      }
      seen.add(r.role);
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await argon2.hash(tempPassword);

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        fullNameAr: dto.fullNameAr,
        fullNameEn: dto.fullNameEn,
        jobTitle: dto.jobTitle,
        phone: dto.phone,
        locale: dto.locale ?? 'ar',
        orgUnitId: dto.orgUnitId,
        managerId: dto.managerId,
        mustChangePassword: true,
        roles: { create: dto.roles.map((r) => ({ role: r.role, scope: r.scope })) },
      },
      select: publicUser,
    });

    await this.audit.record({
      entityType: 'User',
      entityId: user.id,
      action: 'CREATE',
      userId: actor.id,
      after: {
        email: user.email,
        roles: dto.roles.map((r) => `${r.role}@${r.scope}`),
      },
    });

    // The one time the clear password leaves the service.
    return { ...user, temporaryPassword: tempPassword };
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateUserDto) {
    await this.findOne(id);
    if (dto.orgUnitId) {
      const orgUnit = await this.prisma.organizationUnit.findFirst({
        where: { id: dto.orgUnitId, deletedAt: null },
        select: { id: true },
      });
      if (!orgUnit) throw new BadRequestException('orgUnitId does not match an organization unit');
    }
    if (dto.managerId) {
      if (dto.managerId === id) throw new BadRequestException('A user cannot manage themselves');
      const manager = await this.prisma.user.findFirst({
        where: { id: dto.managerId, deletedAt: null },
        select: { id: true },
      });
      if (!manager) throw new BadRequestException('managerId does not match a user');
    }
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        fullNameAr: dto.fullNameAr,
        fullNameEn: dto.fullNameEn,
        jobTitle: dto.jobTitle,
        phone: dto.phone,
        locale: dto.locale,
        orgUnitId: dto.orgUnitId,
        managerId: dto.managerId,
      },
      select: publicUser,
    });
    await this.audit.record({
      entityType: 'User',
      entityId: id,
      action: 'UPDATE',
      userId: actor.id,
    });
    return user;
  }

  async grantRole(actor: AuthenticatedUser, id: string, dto: GrantRoleDto) {
    await this.findOne(id);
    const existing = await this.prisma.userRole.findUnique({
      where: { userId_role: { userId: id, role: dto.role } },
    });
    const role = existing
      ? await this.prisma.userRole.update({
          where: { userId_role: { userId: id, role: dto.role } },
          data: { scope: dto.scope },
        })
      : await this.prisma.userRole.create({
          data: { userId: id, role: dto.role, scope: dto.scope },
        });
    await this.audit.record({
      entityType: 'User',
      entityId: id,
      action: 'UPDATE',
      userId: actor.id,
      after: { grantedRole: `${dto.role}@${dto.scope}` },
    });
    return role;
  }

  async revokeRole(actor: AuthenticatedUser, id: string, role: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: { roles: { select: { role: true } } },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.roles.some((r) => r.role === role)) {
      throw new NotFoundException('User does not hold that role');
    }
    if (user.roles.length === 1) {
      throw new BadRequestException(
        'Cannot revoke the only role — deactivate the user instead, or grant another role first',
      );
    }
    await this.prisma.userRole.delete({
      where: { userId_role: { userId: id, role: role as GrantRoleDto['role'] } },
    });
    await this.audit.record({
      entityType: 'User',
      entityId: id,
      action: 'UPDATE',
      userId: actor.id,
      after: { revokedRole: role },
    });
    return { revoked: role };
  }

  /**
   * Deactivation, not deletion: a commercial record is never hard-deleted, and a
   * user is attached to years of authored work. An inactive user is refused at
   * login; their trail stays intact and answerable.
   */
  async setActive(actor: AuthenticatedUser, id: string, isActive: boolean) {
    const target = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, isActive: true },
    });
    if (!target) throw new NotFoundException('User not found');
    if (!isActive && actor.id === id) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    const user = await this.prisma.user.update({
      where: { id },
      data: { isActive },
      select: publicUser,
    });
    if (!isActive) {
      // Kill live sessions so a deactivated user cannot ride an existing token.
      await this.prisma.refreshToken.deleteMany({ where: { userId: id } });
    }
    await this.audit.record({
      entityType: 'User',
      entityId: id,
      action: isActive ? 'RESTORE' : 'SOFT_DELETE',
      userId: actor.id,
    });
    return user;
  }

  /** Issues a fresh temporary password, returned once, and forces a change. */
  async resetPassword(actor: AuthenticatedUser, id: string) {
    await this.findOne(id);
    const tempPassword = generateTempPassword();
    const passwordHash = await argon2.hash(tempPassword);
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash, mustChangePassword: true },
    });
    // Force re-login everywhere with the new credential.
    await this.prisma.refreshToken.deleteMany({ where: { userId: id } });
    await this.audit.record({
      entityType: 'User',
      entityId: id,
      action: 'UPDATE',
      userId: actor.id,
      after: { passwordReset: true },
    });
    return { id, temporaryPassword: tempPassword };
  }
}
