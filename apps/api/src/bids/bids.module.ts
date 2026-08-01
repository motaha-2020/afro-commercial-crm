import { Module } from '@nestjs/common';
import { BidsController } from './bids.controller';
import { BidsService } from './bids.service';
import { AssessmentService } from './assessment.service';
import { AuthModule } from '../auth/auth.module';
import { ApprovalsModule } from '../approvals/approvals.module';

@Module({
  imports: [AuthModule, ApprovalsModule],
  controllers: [BidsController],
  providers: [BidsService, AssessmentService],
})
export class BidsModule {}
