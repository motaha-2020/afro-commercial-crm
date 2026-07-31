import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { JwtAuthGuard, RolesGuard } from './auth/guards';
import { HealthModule } from './health/health.module';
import { AccountsModule } from './accounts/accounts.module';
import { OpportunitiesModule } from './opportunities/opportunities.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuditModule,
    CommonModule,
    AuthModule,
    HealthModule,
    AccountsModule,
    OpportunitiesModule,
  ],
  providers: [
    // Authentication is on by default across every route; endpoints opt out
    // with @Public(). Forgetting a guard should fail closed, not open.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
