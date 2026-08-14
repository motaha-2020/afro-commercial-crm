import { Global, Module } from '@nestjs/common';
import { AiRouterService } from './ai-router.service';

@Global()
@Module({
  providers: [AiRouterService],
  exports: [AiRouterService],
})
export class AiModule {}
