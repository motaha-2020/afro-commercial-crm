import { Module } from '@nestjs/common';
import { ApprovalsController, PoliciesController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';
import { DiscountsService } from './discounts.service';
import { PoliciesService } from './policies.service';
import { ProposalsService } from './proposals.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [PoliciesController, ApprovalsController],
  providers: [ApprovalsService, DiscountsService, PoliciesService, ProposalsService],
  // Exported because the Bid/No-Bid thresholds move here too: Release 3's
  // provisional 70/55/40 become policy rows rather than constants.
  exports: [PoliciesService],
})
export class ApprovalsModule {}
