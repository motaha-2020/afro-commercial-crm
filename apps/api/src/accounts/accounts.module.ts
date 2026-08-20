import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [AccountsController],
  providers: [AccountsService],
  // Exported so the AI agents can read through the same service, and
  // therefore the same permission scoping, that the HTTP routes use.
  exports: [AccountsService],
})
export class AccountsModule {}
