import { Module } from '@nestjs/common';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';
import { QuotationExpiryJob } from './expiry.job';
import { QuotationExpiryService } from './expiry.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [QuotationsController],
  providers: [QuotationsService, QuotationExpiryService, QuotationExpiryJob],
  // Exported so the AI agents read through the same service, and therefore
  // the same permission scoping, that the HTTP routes use.
  exports: [QuotationsService],
})
export class QuotationsModule {}
