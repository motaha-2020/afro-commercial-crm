import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CodeGeneratorService } from '../common/code-generator.service';
import { OpportunityAccessService } from '../common/opportunity-access.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  CreateProposalDto,
  CreateProposalVersionDto,
  SubmitProposalVersionDto,
} from './dto';

/**
 * Proposal types that quote the customer a price, and therefore may not exist
 * without an approved costing behind them. A purely technical proposal carries
 * no number, so the rule would be meaningless there.
 */
const COMMERCIAL_TYPES = [
  'COMMERCIAL',
  'COMBINED',
  'BUDGETARY',
  'INITIAL',
  'REVISED',
  'BAFO',
  'FINAL',
];

@Injectable()
export class ProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly codes: CodeGeneratorService,
    private readonly opportunities: OpportunityAccessService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(user: AuthenticatedUser, opportunityId: string) {
    await this.opportunities.assert(user, opportunityId);

    return this.prisma.proposal.findMany({
      where: { opportunityId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        versions: {
          where: { deletedAt: null },
          orderBy: { versionNumber: 'desc' },
          include: {
            costingVersion: {
              select: { id: true, versionNumber: true, status: true, marginPercent: true },
            },
            submittedBy: { select: { id: true, fullNameEn: true, fullNameAr: true } },
          },
        },
      },
    });
  }

  async create(user: AuthenticatedUser, opportunityId: string, dto: CreateProposalDto) {
    await this.opportunities.assert(user, opportunityId);

    const proposal = await this.prisma.proposal.create({
      data: {
        code: await this.codes.next('PRP', 'proposal', new Date().getFullYear()),
        opportunityId,
        bidId: dto.bidId,
        title: dto.title,
        createdById: user.id,
      },
    });

    await this.audit.record({
      entityType: 'Proposal',
      entityId: proposal.id,
      action: 'CREATE',
      userId: user.id,
      after: { opportunityId, title: dto.title },
    });

    return proposal;
  }

  /**
   * Add a version.
   *
   * The spec's rule, stated as plainly as it ever states anything (section 26):
   * "يجب أن يرتبط كل Commercial Proposal بـCosting Version معتمدة. لا يسمح
   * للمستخدم بإدخال سعر عشوائي لا يرتبط بالتسعير." A price with no approved
   * costing behind it is exactly what this refuses — not warns about.
   *
   * And the costing must be APPROVED, not merely present. A draft costing is a
   * work in progress; quoting a customer from one means quoting a number that
   * nobody has signed off and that may still change underneath the offer.
   */
  async addVersion(user: AuthenticatedUser, proposalId: string, dto: CreateProposalVersionDto) {
    const proposal = await this.proposalOr404(user, proposalId);
    const type = dto.type ?? 'INITIAL';
    const isCommercial = COMMERCIAL_TYPES.includes(type);

    if (isCommercial) {
      if (!dto.costingVersionId) {
        throw new BadRequestException(
          'A commercial proposal must reference an approved costing version — a price with no costing behind it is not allowed',
        );
      }

      const costing = await this.prisma.costingVersion.findFirst({
        where: { id: dto.costingVersionId, deletedAt: null },
        include: { scenario: { select: { opportunityId: true, currency: true } } },
      });
      if (!costing) throw new NotFoundException('Costing version not found');

      if (costing.scenario.opportunityId !== proposal.opportunityId) {
        throw new BadRequestException(
          'That costing version belongs to a different opportunity',
        );
      }
      if (costing.status !== 'APPROVED') {
        throw new BadRequestException(
          `The costing version is ${costing.status}. Only an approved costing may be quoted to a customer.`,
        );
      }

      // A selling price that contradicts the costing it claims to come from is
      // the same error the rule exists to prevent, wearing a reference.
      if (dto.sellingPrice !== undefined && costing.totalPrice !== null) {
        const approved = Number(costing.totalPrice);
        if (Math.abs(dto.sellingPrice - approved) > 0.01) {
          throw new BadRequestException({
            message:
              'The selling price does not match the approved costing. Revise the costing and approve it rather than overriding the price here.',
            approvedPrice: approved,
            attempted: dto.sellingPrice,
          });
        }
      }
    }

    const last = await this.prisma.proposalVersion.findFirst({
      where: { proposalId, deletedAt: null },
      orderBy: { versionNumber: 'desc' },
    });

    const version = await this.prisma.proposalVersion.create({
      data: {
        proposalId,
        versionNumber: (last?.versionNumber ?? 0) + 1,
        type: type as never,
        costingVersionId: dto.costingVersionId,
        sellingPrice: dto.sellingPrice,
        currency: dto.currency ?? 'USD',
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
      },
    });

    await this.audit.record({
      entityType: 'ProposalVersion',
      entityId: version.id,
      action: 'CREATE',
      userId: user.id,
      after: {
        proposalId,
        versionNumber: version.versionNumber,
        type,
        costingVersionId: dto.costingVersionId ?? null,
      },
    });

    return version;
  }

  /**
   * Send it. The spec: "حفظ نسخة العرض المرسلة. منع استبدالها دون Revision."
   * A submitted version is a fact about what the customer holds; it is never
   * edited afterwards, only superseded by a new version.
   */
  async submit(user: AuthenticatedUser, versionId: string, dto: SubmitProposalVersionDto) {
    const version = await this.versionOr404(user, versionId);

    if (version.status === 'SUBMITTED') {
      throw new BadRequestException(
        'This version has already been sent. Create a revision rather than replacing what the customer holds.',
      );
    }
    if (version.status === 'SUPERSEDED' || version.status === 'WITHDRAWN') {
      throw new BadRequestException(`This version is ${version.status} and cannot be sent`);
    }

    const [submitted] = await this.prisma.$transaction([
      this.prisma.proposalVersion.update({
        where: { id: versionId },
        data: {
          status: 'SUBMITTED',
          submittedAt: new Date(),
          submittedById: user.id,
          submissionMethod: dto.submissionMethod,
          submittedTo: dto.submittedTo,
        },
      }),
      // Only one version is the live offer; earlier ones become history in the
      // same act rather than leaving two rows both claiming to be current.
      this.prisma.proposalVersion.updateMany({
        where: {
          proposalId: version.proposalId,
          status: 'SUBMITTED',
          deletedAt: null,
          NOT: { id: versionId },
        },
        data: { status: 'SUPERSEDED' },
      }),
    ]);

    await this.audit.record({
      entityType: 'ProposalVersion',
      entityId: versionId,
      action: 'STATUS_CHANGE',
      userId: user.id,
      before: { status: version.status },
      after: {
        status: 'SUBMITTED',
        submittedTo: dto.submittedTo ?? null,
        method: dto.submissionMethod ?? null,
      },
    });

    await this.notifications.dispatchEvent('PROPOSAL_SUBMITTED', {
      title: `Proposal sent: ${version.proposal.title}`,
      body: `Version ${version.versionNumber} to ${dto.submittedTo ?? 'the customer'}`,
      entityType: 'ProposalVersion',
      entityId: versionId,
    });

    return submitted;
  }

  private async proposalOr404(user: AuthenticatedUser, id: string) {
    const row = await this.prisma.proposal.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Proposal not found');
    await this.opportunities.assert(user, row.opportunityId);
    return row;
  }

  private async versionOr404(user: AuthenticatedUser, id: string) {
    const row = await this.prisma.proposalVersion.findFirst({
      where: { id, deletedAt: null },
      include: { proposal: true },
    });
    if (!row) throw new NotFoundException('Proposal version not found');
    await this.opportunities.assert(user, row.proposal.opportunityId);
    return row;
  }
}
