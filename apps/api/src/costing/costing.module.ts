import { Module } from '@nestjs/common';
import { CostingController } from './costing.controller';
import { CostingService } from './costing.service';
import { CostRulesService } from './cost-rules.service';
import { LibraryService } from './library.service';
import { TaxRulesService } from './tax-rules.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [CostingController],
  providers: [CostingService, CostRulesService, LibraryService, TaxRulesService],
})
export class CostingModule {}
