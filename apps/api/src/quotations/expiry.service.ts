import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Days before expiry at which somebody is told.
 *
 * Two fixed points rather than "anything within a week", because a job that
 * runs daily and notifies everything inside a window notifies the same offer
 * seven times, and the seventh is noise that teaches people to ignore the
 * first. Three days is time to ask the supplier to reconfirm; one day is the
 * last useful moment to notice.
 */
export const EXPIRY_WARNING_DAYS = [3, 1];

const DAY_MS = 86_400_000;

@Injectable()
export class QuotationExpiryService {
  private readonly logger = new Logger(QuotationExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Warn about supplier offers that are about to lapse.
   *
   * The expired offer already refuses to be selected and is already marked on
   * the comparison. What was missing is the part before that: the offer stops
   * being usable while nobody is looking at the screen, and the first anyone
   * hears of it is a comparison that has quietly lost a column.
   *
   * Selected offers are skipped — the decision has been taken and the validity
   * date has done its work — and so are offers on opportunities that are no
   * longer live, where nobody needs to chase a supplier about a dead deal.
   */
  async warnExpiring(now = new Date()): Promise<{ notified: number; quotations: number }> {
    const windows = EXPIRY_WARNING_DAYS.map((days) => ({
      days,
      from: new Date(now.getTime() + days * DAY_MS),
      to: new Date(now.getTime() + (days + 1) * DAY_MS),
    }));

    let notified = 0;
    let quotations = 0;

    for (const window of windows) {
      const due = await this.prisma.partnerQuotation.findMany({
        where: {
          deletedAt: null,
          isSelected: false,
          validUntil: { gte: window.from, lt: window.to },
          opportunity: { deletedAt: null, status: 'ACTIVE' },
        },
        include: {
          partner: { select: { legalName: true } },
          opportunity: { select: { id: true, code: true, name: true } },
        },
      });

      for (const q of due) {
        quotations += 1;
        notified += await this.notifications.dispatchEvent('QUOTATION_EXPIRING', {
          title: `Supplier offer expires in ${window.days} day(s): ${q.partner.legalName}`,
          // The opportunity, not just the quotation: the person who has to act
          // thinks in deals, and the code is what they will search for.
          body: `${q.code} on ${q.opportunity.code} — ${q.opportunity.name}. Ask the supplier to reconfirm, or select it before it lapses.`,
          entityType: 'PartnerQuotation',
          entityId: q.id,
        });
      }
    }

    if (quotations > 0) {
      this.logger.log(
        `Quotation expiry warnings: ${quotations} offer(s), ${notified} notification(s)`,
      );
    }
    return { notified, quotations };
  }
}
