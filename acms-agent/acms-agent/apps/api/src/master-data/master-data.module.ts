import { Module } from '@nestjs/common';
import { MasterDataController } from './master-data.controller';

@Module({
  controllers: [MasterDataController],
})
export class MasterDataModule {}
