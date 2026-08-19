import { Module } from '@nestjs/common';
import {
  ApprovalsController,
  PoliciesController,
  WorkflowsController,
} from './approvals.controller';
import { ApprovalsService } from './approvals.service';
import { DiscountsService } from './discounts.service';
import { PoliciesService } from './policies.service';
import { ProposalsService } from './proposals.service';
import { WorkflowsService } from './workflows.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [PoliciesController, ApprovalsController, WorkflowsController],
  providers: [
    ApprovalsService,
    DiscountsService,
    PoliciesService,
    ProposalsService,
    WorkflowsService,
  ],
  // Exported because the Bid/No-Bid thresholds move here too: Release 3's
  // provisional 70/55/40 become policy rows rather than constants.
  exports: [PoliciesService],
})
export class ApprovalsModule {}
