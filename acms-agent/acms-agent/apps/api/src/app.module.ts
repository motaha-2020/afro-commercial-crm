import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { JwtAuthGuard, RolesGuard } from './auth/guards';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { HttpLoggingInterceptor } from './common/http-logging.interceptor';
import { RequestContextMiddleware } from './common/request-context.middleware';
import { GovernanceModule } from './governance/governance.module';
import { HealthModule } from './health/health.module';
import { AccountsModule } from './accounts/accounts.module';
import { ContactsModule } from './contacts/contacts.module';
import { LeadsModule } from './leads/leads.module';
import { ActivitiesModule } from './activities/activities.module';
import { OpportunitiesModule } from './opportunities/opportunities.module';
import { ScopeModule } from './scope/scope.module';
import { BidsModule } from './bids/bids.module';
import { CostingModule } from './costing/costing.module';
import { PartnersModule } from './partners/partners.module';
import { QuotationsModule } from './quotations/quotations.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { ContractsModule } from './contracts/contracts.module';
import { MetricsModule } from './metrics/metrics.module';
import { DocumentsModule } from './documents/documents.module';
import { NotificationsModule } from './notifications/notifications.module';
import { MasterDataModule } from './master-data/master-data.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuditModule,
    GovernanceModule,
    CommonModule,
    AuthModule,
    HealthModule,
    AccountsModule,
    ContactsModule,
    LeadsModule,
    ActivitiesModule,
    OpportunitiesModule,
    ScopeModule,
    BidsModule,
    CostingModule,
    PartnersModule,
    QuotationsModule,
    ApprovalsModule,
    ContractsModule,
    MetricsModule,
    DocumentsModule,
    NotificationsModule,
    MasterDataModule,
  ],
  providers: [
    // Authentication is on by default across every route; endpoints opt out
    // with @Public(). Forgetting a guard should fail closed, not open.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: HttpLoggingInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
