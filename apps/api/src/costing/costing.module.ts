import { Module } from '@nestjs/common';
import { CostingController } from './costing.controller';
import { CostingService } from './costing.service';
import { LibraryService } from './library.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [CostingController],
  providers: [CostingService, LibraryService],
})
export class CostingModule {}
