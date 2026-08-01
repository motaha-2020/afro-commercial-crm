import { Global, Module } from '@nestjs/common';
import { CodeGeneratorService } from './code-generator.service';
import { AccountAccessService } from './account-access.service';
import { OpportunityAccessService } from './opportunity-access.service';
import { AuthModule } from '../auth/auth.module';

@Global()
@Module({
  // For DataScopeService. AuthModule does not import this one, so no cycle.
  imports: [AuthModule],
  providers: [CodeGeneratorService, AccountAccessService, OpportunityAccessService],
  exports: [CodeGeneratorService, AccountAccessService, OpportunityAccessService],
})
export class CommonModule {}
