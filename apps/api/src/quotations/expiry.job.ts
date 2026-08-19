import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { QuotationExpiryService } from './expiry.service';

/**
 * The daily sweep for offers about to lapse.
 *
 * Separate from the service that does the work so the behaviour can be run on
 * demand — and tested — without waiting for a clock. A job whose only trigger
 * is the calendar is a job nobody ever sees fail.
 */
@Injectable()
export class QuotationExpiryJob {
  private readonly logger = new Logger(QuotationExpiryJob.name);

  constructor(private readonly expiry: QuotationExpiryService) {}

  // Early morning: the warning wants to be waiting when procurement starts,
  // not arriving in the middle of their afternoon.
  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async run() {
    try {
      await this.expiry.warnExpiring();
    } catch (err) {
      // A failed sweep must not take the API down with it; tomorrow's run is
      // half a day away and the offers are still there.
      this.logger.error(`Expiry sweep failed: ${(err as Error).message}`);
    }
  }
}
