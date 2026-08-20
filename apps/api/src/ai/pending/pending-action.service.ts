import { createHash, randomInt } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../auth/auth.types';

/** Long enough to read the proposal field by field, short enough not to linger. */
const TTL_MINUTES = 10;

export interface ProposalInput {
  conversationId?: string;
  action: string;
  resource: string;
  /** The code the agent named. Resolved to a real record before anything is stored. */
  targetCode: string;
  /** The name the agent claimed the code belongs to, when it named one. */
  claimedName?: string;
  body: Prisma.InputJsonValue;
}

export interface Proposal {
  code: string;
  targetCode: string;
  action: string;
  resource: string;
  body: Record<string, unknown>;
  expiresAt: Date;
}

/** Resolves a record code under the asking user's own visibility. */
export type CodeResolver = (
  user: AuthenticatedUser,
  resource: string,
  code: string,
) => Promise<{ id: string; name: string } | null>;

/** Runs the change once a code is claimed, as the user, through the domain service. */
export type ActionExecutor = (
  user: AuthenticatedUser,
  action: string,
  targetId: string,
  body: Record<string, unknown>,
) => Promise<void>;

const hash = (code: string) => createHash('sha256').update(code).digest('hex');

@Injectable()
export class PendingActionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Turns an agent's proposal into a pending action — or refuses it.
   *
   * The resolution step is not a formality. Asked to create an opportunity for
   * an account that did not exist, a model once invented a *real* account code
   * belonging to another company. Checking that the code means something, not
   * merely that it is well formed, is what stopped that; checking that the
   * name matches what the code resolves to is what stops the subtler version.
   */
  async propose(
    user: AuthenticatedUser,
    input: ProposalInput,
    resolve: CodeResolver,
  ): Promise<Proposal> {
    const target = await resolve(user, input.resource, input.targetCode);
    if (!target) {
      throw new BadRequestException(
        `الكود ${input.targetCode} لا يقابل أي سجل تراه — لم يُنشأ أي اقتراح.`,
      );
    }

    if (input.claimedName && !namesAgree(input.claimedName, target.name)) {
      throw new BadRequestException(
        `الكود ${input.targetCode} يخصّ «${target.name}» لا «${input.claimedName}» — لم يُنشأ أي اقتراح.`,
      );
    }

    const code = String(randomInt(1000, 10000));
    const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000);

    await this.prisma.pendingAction.create({
      data: {
        userId: user.id,
        conversationId: input.conversationId,
        codeHash: hash(code),
        action: input.action,
        resource: input.resource,
        targetId: target.id,
        targetCode: input.targetCode,
        body: input.body,
        expiresAt,
      },
    });

    return {
      code,
      targetCode: input.targetCode,
      action: input.action,
      resource: input.resource,
      body: input.body as Record<string, unknown>,
      expiresAt,
    };
  }

  /**
   * Verifies and consumes in one statement.
   *
   * A conditional DELETE ... RETURNING is atomic in Postgres, so exactly one
   * of two simultaneous confirmations gets a row back. Read-then-delete would
   * let both win, and would let a code be replayed.
   */
  async claim(
    user: AuthenticatedUser,
    code: string,
    execute: ActionExecutor,
  ): Promise<{ ok: boolean; message: string }> {
    const claimed = await this.prisma.$queryRaw<
      { action: string; targetId: string; targetCode: string; body: Prisma.JsonValue }[]
    >`
      DELETE FROM "PendingAction"
      WHERE "id" = (
        SELECT "id" FROM "PendingAction"
        WHERE "userId" = ${user.id}
          AND "codeHash" = ${hash(code)}
          AND "expiresAt" > NOW()
        ORDER BY "createdAt" DESC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "action", "targetId", "targetCode", "body"
    `;

    const action = claimed[0];
    if (!action) {
      return {
        ok: false,
        message: 'لا يوجد إجراء معلّق بهذا الرمز، أو انتهت مهلته — لم يُنفَّذ أي تغيير.',
      };
    }

    try {
      await execute(user, action.action, action.targetId, action.body as Record<string, unknown>);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, message: `فشل التنفيذ على ${action.targetCode}: ${reason}` };
    }

    return { ok: true, message: `تم تنفيذ ${action.action} على ${action.targetCode}.` };
  }

  /** Housekeeping for codes nobody confirmed. */
  purgeExpired() {
    return this.prisma.pendingAction.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  }
}

/**
 * Deliberately loose: the user asked in Arabic for "شركة النيل" and the record
 * reads "شركة النيل للمقاولات". Requiring equality would reject correct
 * proposals, so containment either way is enough to show they refer to the
 * same record — the id resolution already did the real work.
 */
function namesAgree(claimed: string, actual: string): boolean {
  const a = claimed.trim().toLowerCase();
  const b = actual.trim().toLowerCase();
  return a.length > 0 && (b.includes(a) || a.includes(b));
}
