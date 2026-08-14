import { Global, Module } from '@nestjs/common';
import { SodService } from './sod.service';
import { GovernanceController } from './governance.controller';

/**
 * Global: separation of duties is checked from wherever an approval happens,
 * and every release adds more of those places.
 */
@Global()
@Module({
  controllers: [GovernanceController],
  providers: [SodService],
  exports: [SodService],
})
export class GovernanceModule {}
