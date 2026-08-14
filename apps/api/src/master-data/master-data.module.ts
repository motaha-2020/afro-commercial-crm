import { Global, Module } from '@nestjs/common';
import { MasterDataController } from './master-data.controller';
import { RefListsController } from './ref-lists.controller';
import { RefListsService } from './ref-lists.service';

/**
 * Global because validation across the API now asks this service which codes
 * are legal — that question used to be answered by a compiled enum, so it was
 * available everywhere. It still has to be.
 */
@Global()
@Module({
  controllers: [MasterDataController, RefListsController],
  providers: [RefListsService],
  exports: [RefListsService],
})
export class MasterDataModule {}
