import { Module } from '@nestjs/common';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ClausesService } from './clauses.service';
import { HandoverService } from './handover.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ContractsController],
  providers: [ContractsService, ClausesService, HandoverService],
})
export class ContractsModule {}
