import { Module } from '@nestjs/common';
import { OpportunitiesController } from './opportunities.controller';
import { OpportunitiesService } from './opportunities.service';
import { OpportunityImportService } from './opportunity-import.service';
import { AuthModule } from '../auth/auth.module';
// The importer checks every code it is given against the lists an
// administrator maintains, so an industry added this morning imports today.
import { MasterDataModule } from '../master-data/master-data.module';

@Module({
  imports: [AuthModule, MasterDataModule],
  controllers: [OpportunitiesController],
  providers: [OpportunitiesService, OpportunityImportService],
})
export class OpportunitiesModule {}
