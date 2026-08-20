import { ConfigService } from '@nestjs/config';
import { AiRouterService } from '../ai-router.service';
import { AgentRunnerService } from '../agents/agent-runner.service';
import { OrchestratorService } from '../agents/orchestrator.service';
import { SalesIntelligenceAgent } from '../agents/sales-intelligence.agent';
import { FinancialIntelligenceAgent } from '../agents/financial-intelligence.agent';
import { ExecutiveReportingAgent } from '../agents/executive-reporting.agent';
import { ComplianceApprovalAgent } from '../agents/compliance-approval.agent';
import { ActionAgent } from '../agents/action.agent';
import { ActionExecutorService } from '../agents/action-executor.service';
import { ReportAgent } from '../agents/report.agent';
import { PricingPortfolioService } from '../agents/pricing-portfolio.service';
import { PendingActionService } from '../pending/pending-action.service';
import { IntentGateService } from '../gate/intent-gate.service';
import { AiChatService } from '../chat/ai-chat.service';
import { COSTING_SCENARIOS, visibleTo } from './fixtures';
import type { AuthenticatedUser } from '../../auth/auth.types';

/**
 * Wires the real agent stack — real router, real prompts, real tool loop, real
 * projection, real ledger, real guard — over fixture data and an in-memory
 * stand-in for the pending-action table.
 *
 * The point is to exercise the parts that a unit test mocks away: whether the
 * model actually calls the tools it was given, whether the answers it produces
 * survive the guard, and whether the scoping holds when nobody is checking it
 * by hand. Only the data layer is fake.
 */

export interface Harness {
  chat: AiChatService;
  pendingRows: any[];
  executed: { action: string; targetId: string; body: Record<string, unknown> }[];
}

export function buildHarness(): Harness {
  const executed: Harness['executed'] = [];
  const pendingRows: any[] = [];

  const opportunitiesService = {
    async list(user: AuthenticatedUser, query: any = {}) {
      let items = visibleTo(user);
      if (query?.stage) items = items.filter((o) => o.stage === query.stage);
      if (query?.status) items = items.filter((o) => o.status === query.status);
      if (query?.country) items = items.filter((o) => o.country === query.country);
      if (query?.health) items = items.filter((o) => o.health === query.health);
      if (query?.search) {
        const q = String(query.search).toLowerCase();
        items = items.filter(
          (o) => o.code.toLowerCase().includes(q) || o.name.toLowerCase().includes(q),
        );
      }
      return { items, total: items.length };
    },
    async changeStage(_u: AuthenticatedUser, id: string, body: any) {
      executed.push({ action: 'opportunity.changeStage', targetId: id, body });
    },
    async changeStatus(_u: AuthenticatedUser, id: string, body: any) {
      executed.push({ action: 'opportunity.changeStatus', targetId: id, body });
    },
    async update(_u: AuthenticatedUser, id: string, body: any) {
      executed.push({ action: 'opportunity.updateNextStep', targetId: id, body });
    },
  };

  const accountsService = {
    async list(user: AuthenticatedUser) {
      const seen = new Map<string, any>();
      for (const o of visibleTo(user)) {
        if (!seen.has(o.account.legalName)) {
          seen.set(o.account.legalName, {
            code: `ACC-${String(seen.size + 1).padStart(6, '0')}`,
            legalName: o.account.legalName,
            type: 'CUSTOMER',
            country: o.country,
            creditStatus: 'GOOD',
            owner: o.owner,
          });
        }
      }
      const items = [...seen.values()];
      return { items, total: items.length };
    },
  };

  const activitiesService = {
    async list() {
      return { items: [], total: 0 };
    },
  };

  const prisma = {
    costingScenario: {
      async findFirst({ where }: any) {
        const fixture = COSTING_SCENARIOS[where.opportunityId];
        if (fixture === '__THROW__') throw new Error('costing not readable');
        return fixture ?? null;
      },
    },
    pendingAction: {
      async create({ data }: any) {
        pendingRows.push({ ...data, createdAt: new Date() });
        return data;
      },
      async deleteMany() {
        return { count: 0 };
      },
    },
    // Mirrors the conditional DELETE ... RETURNING the real service relies on:
    // one caller gets the row, everyone else gets nothing.
    async $queryRaw(_strings: TemplateStringsArray, ...values: any[]) {
      const [userId, codeHash] = values;
      const index = pendingRows.findIndex(
        (r) => r.userId === userId && r.codeHash === codeHash && r.expiresAt > new Date(),
      );
      if (index === -1) return [];
      return [pendingRows.splice(index, 1)[0]];
    },
  };

  const metricsService = {
    async dashboard(user: AuthenticatedUser) {
      const rows = visibleTo(user);
      const open = rows.filter((o) => o.status === 'ACTIVE' || o.status === 'ON_HOLD');
      const valued = open.filter((o) => o.estimatedValue !== null);
      return {
        asOf: new Date('2026-08-20T00:00:00Z'),
        metrics: [
          {
            code: 'PIPELINE_VALUE',
            value: valued.reduce((s, o) => s + Number(o.estimatedValue), 0),
            unit: 'CURRENCY',
            basis: valued.length,
            definition: { formula: 'Sum of estimated value across open opportunities', gameable: true },
          },
          {
            // Nothing has closed, so this is genuinely uncomputable — the
            // simulation checks that it never comes back as zero.
            code: 'WIN_RATE',
            value: null,
            unit: 'PERCENT',
            basis: 0,
            unavailableReason: 'NO_DATA',
            definition: { formula: 'Won / (Won + Lost)', gameable: false },
          },
        ],
        pendingErpIntegration: ['CASH_COLLECTED'],
        scope: { opportunities: rows.length, approvedCostings: 1 },
      };
    },
    async report(user: AuthenticatedUser) {
      return { ...(await this.dashboard(user)), withheld: [] };
    },
    async metric() {
      return {
        code: 'WIN_RATE',
        value: null,
        unit: 'PERCENT',
        basis: 0,
        unavailableReason: 'NO_DATA',
        definition: { formula: 'Won / (Won + Lost)', gameable: false },
      };
    },
  };

  const analyticsService = { async overview() { return { byStage: [] }; } };
  const approvalsService = { async myQueue() { return []; }, async findOne() { return null; } };
  const auditService = { async forEntity() { return []; } };
  const storageService = { async ping() { return false; }, async put() { throw new Error('no storage'); } };
  const memoryService = {
    async startOrGetConversation() { return { id: 'sim-conversation' }; },
    async appendUserMessage() {},
    async appendAssistantMessage() {},
  };

  const router = new AiRouterService(
    new ConfigService({ ...process.env } as never),
  );
  router.onModuleInit();

  const runner = new AgentRunnerService(router);
  const pricing = new PricingPortfolioService(prisma as never, opportunitiesService as never);
  const pending = new PendingActionService(prisma as never);
  const executor = new ActionExecutorService(opportunitiesService as never);

  const orchestrator = new OrchestratorService(
    router,
    runner,
    new SalesIntelligenceAgent(
      opportunitiesService as never,
      accountsService as never,
      activitiesService as never,
    ),
    new FinancialIntelligenceAgent(
      pricing,
      {} as never,
      {} as never,
      opportunitiesService as never,
    ),
    new ExecutiveReportingAgent(metricsService as never, analyticsService as never),
    new ComplianceApprovalAgent(approvalsService as never, {} as never, auditService as never),
    new ActionAgent(pending, executor, opportunitiesService as never),
    new ReportAgent(storageService as never, opportunitiesService as never, pricing),
  );

  const chat = new AiChatService(
    new IntentGateService(),
    orchestrator,
    pending,
    executor,
    memoryService as never,
  );

  return { chat, pendingRows, executed };
}
