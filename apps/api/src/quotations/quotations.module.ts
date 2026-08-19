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
})
export class QuotationsModule {}
