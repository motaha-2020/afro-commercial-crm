import { Global, Module } from '@nestjs/common';
import { AiRouterService } from './ai-router.service';
import { AiMemoryService } from './memory/ai-memory.service';
import { AiSuggestionService } from './suggestions/ai-suggestion.service';
import { IntentGateService } from './gate/intent-gate.service';
import { PendingActionService } from './pending/pending-action.service';
import { AgentRunnerService } from './agents/agent-runner.service';
import { SalesIntelligenceAgent } from './agents/sales-intelligence.agent';
import { FinancialIntelligenceAgent } from './agents/financial-intelligence.agent';
import { PricingPortfolioService } from './agents/pricing-portfolio.service';
import { ExecutiveReportingAgent } from './agents/executive-reporting.agent';
import { ComplianceApprovalAgent } from './agents/compliance-approval.agent';
import { ActionAgent } from './agents/action.agent';
import { ActionExecutorService } from './agents/action-executor.service';
import { ReportAgent } from './agents/report.agent';
import { OrchestratorService } from './agents/orchestrator.service';
import { AiChatService } from './chat/ai-chat.service';
import { AiController } from './ai.controller';
import { OpportunitiesModule } from '../opportunities/opportunities.module';
import { AccountsModule } from '../accounts/accounts.module';
import { ActivitiesModule } from '../activities/activities.module';
import { CostingModule } from '../costing/costing.module';
import { QuotationsModule } from '../quotations/quotations.module';
import { MetricsModule } from '../metrics/metrics.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { DocumentsModule } from '../documents/documents.module';

/**
 * The agents call the domain services in-process rather than over HTTP, which
 * is what lets every read run under the asking user's own permissions without
 * a token being passed anywhere.
 */
@Global()
@Module({
  imports: [
    OpportunitiesModule,
    AccountsModule,
    ActivitiesModule,
    CostingModule,
    QuotationsModule,
    MetricsModule,
    ApprovalsModule,
    DocumentsModule,
  ],
  controllers: [AiController],
  providers: [
    AiRouterService,
    AiMemoryService,
    AiSuggestionService,
    IntentGateService,
    PendingActionService,
    AgentRunnerService,
    SalesIntelligenceAgent,
    PricingPortfolioService,
    FinancialIntelligenceAgent,
    ExecutiveReportingAgent,
    ComplianceApprovalAgent,
    ActionExecutorService,
    ActionAgent,
    ReportAgent,
    OrchestratorService,
    AiChatService,
  ],
  exports: [AiRouterService, AiMemoryService, AiSuggestionService],
})
export class AiModule {}
