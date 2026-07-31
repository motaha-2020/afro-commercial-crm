import { Module } from '@nestjs/common';
import { BidsController } from './bids.controller';
import { BidsService } from './bids.service';
import { AssessmentService } from './assessment.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [BidsController],
  providers: [BidsService, AssessmentService],
})
export class BidsModule {}
