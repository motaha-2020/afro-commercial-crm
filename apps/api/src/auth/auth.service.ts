import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { SignOptions } from 'jsonwebtoken';
import * as argon2 from 'argon2';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser, TokenPair } from './auth.types';

/**
 * Refresh tokens are stored as SHA-256 digests. The raw token only ever exists
 * in the response body, so a database leak does not hand over live sessions.
 * Argon2 would be wrong here: these are high-entropy random values, not
 * user-chosen passwords, so key stretching buys nothing and costs latency on
 * every refresh.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async validateUser(email: string, password: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null },
      include: { roles: true },
    });

    // Verify against a dummy hash when the user is absent so that response time
    // does not reveal whether an address is registered.
    if (!user) {
      await argon2.verify(
        '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHR2YWx1ZQ$0000000000000000000000000000000000000000000',
        password,
      ).catch(() => undefined);
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!valid) {
      await this.audit.record({
        entityType: 'User',
        entityId: user.id,
        action: 'LOGIN_FAILED',
        userId: user.id,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new ForbiddenException('Account is deactivated');
    }

    return {
      id: user.id,
      email: user.email,
      orgUnitId: user.orgUnitId,
      roles: user.roles.map((r) => ({ role: r.role, scope: r.scope })),
    };
  }

  async login(
    email: string,
    password: string,
    context: { ipAddress?: string; userAgent?: string } = {},
  ): Promise<TokenPair> {
    const user = await this.validateUser(email, password);
    const tokens = await this.issueTokens(user, context);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.audit.record({
      entityType: 'User',
      entityId: user.id,
      action: 'LOGIN',
      userId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return tokens;
  }

  async refresh(
    refreshToken: string,
    context: { ipAddress?: string; userAgent?: string } = {},
  ): Promise<TokenPair> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { user: { include: { roles: true } } },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (!stored.user.isActive || stored.user.deletedAt) {
      throw new ForbiddenException('Account is unavailable');
    }

    // Rotate: the presented token dies as the replacement is minted, so a
    // stolen token is usable at most once and only before the legitimate holder
    // refreshes.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(
      {
        id: stored.user.id,
        email: stored.user.email,
        orgUnitId: stored.user.orgUnitId,
        roles: stored.user.roles.map((r) => ({ role: r.role, scope: r.scope })),
      },
      context,
    );
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(
    user: AuthenticatedUser,
    context: { ipAddress?: string; userAgent?: string },
  ): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        email: user.email,
        orgUnitId: user.orgUnitId,
        roles: user.roles,
      },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        // jsonwebtoken types expiresIn as a `ms` template literal, which a
        // config lookup cannot satisfy statically. The value is validated at
        // boot by env.validation.ts, so the assertion is checked, not assumed.
        expiresIn: (this.config.get<string>('JWT_ACCESS_TTL') ??
          '15m') as SignOptions['expiresIn'],
      },
    );

    const refreshToken = randomUUID() + randomUUID();
    const ttlDays = Number(
      (this.config.get<string>('JWT_REFRESH_TTL') ?? '7d').replace('d', ''),
    );

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });

    return { accessToken, refreshToken };
  }
}
