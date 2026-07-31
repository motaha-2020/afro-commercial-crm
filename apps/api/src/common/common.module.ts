import { Global, Module } from '@nestjs/common';
import { CodeGeneratorService } from './code-generator.service';
import { OpportunityAccessService } from './opportunity-access.service';
import { AuthModule } from '../auth/auth.module';

@Global()
@Module({
  // For DataScopeService. AuthModule does not import this one, so no cycle.
  imports: [AuthModule],
  providers: [CodeGeneratorService, OpportunityAccessService],
  exports: [CodeGeneratorService, OpportunityAccessService],
})
export class CommonModule {}
