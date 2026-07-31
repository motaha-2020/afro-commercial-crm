import { Module } from '@nestjs/common';
import { ScopeController } from './scope.controller';
import { ScopeService } from './scope.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ScopeController],
  providers: [ScopeService],
})
export class ScopeModule {}
