import { Injectable, Logger } from '@nestjs/common';
import { AiRouterService } from '../ai-router.service';
import { AiTask } from '../ai.types';
import { classifyProviderFailure } from '../errors/provider-error';
import { AgentRunnerService, type AgentOutcome } from './agent-runner.service';
import { SalesIntelligenceAgent } from './sales-intelligence.agent';
import { FinancialIntelligenceAgent } from './financial-intelligence.agent';
import { ExecutiveReportingAgent } from './executive-reporting.agent';
import { ComplianceApprovalAgent } from './compliance-approval.agent';
import { ActionAgent } from './action.agent';
import { ReportAgent } from './report.agent';
import type { Intent } from '../gate/intent-gate.service';
import type { SpecialistAgent, ToolContext } from './agent.types';

const ORCHESTRATOR_PROMPT = `أنت منسّق "ACMS Agent" لمنظومة أفرو التجارية. أنت لا تملك بيانات — توجّه فقط.

قواعد:
- ممنوع الرد على أي سؤال عن النظام قبل استدعاء وكيل فعليًا. الرد من عندك خطأ فادح.
- ممنوع ادّعاء أنك سألت وكيلًا أو أن إجراءً نُفِّذ.
- "لا توجد بيانات" لا تُقال إلا إذا قالها وكيل.
- عند التردد اختر الأقرب بدل الامتناع. ممنوع اختراع رقم أو اسم.

أعد JSON فقط بالشكل: {"agent":"<اسم الوكيل>"}`;

/**
 * Chooses one specialist and relays its answer verbatim.
 *
 * It holds no data and no read tools on purpose: an orchestrator that can
 * answer will answer, and its answer has nothing behind it.
 */
@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);
  private readonly agents = new Map<string, SpecialistAgent>();

  constructor(
    private readonly router: AiRouterService,
    private readonly runner: AgentRunnerService,
    salesIntelligence: SalesIntelligenceAgent,
    financialIntelligence: FinancialIntelligenceAgent,
    executiveReporting: ExecutiveReportingAgent,
    complianceAndApproval: ComplianceApprovalAgent,
    actionAgent: ActionAgent,
    reportAgent: ReportAgent,
  ) {
    // Later phases add their specialist here; nothing else changes.
    this.register(salesIntelligence);
    this.register(financialIntelligence);
    this.register(executiveReporting);
    this.register(complianceAndApproval);
    this.register(actionAgent);
    this.register(reportAgent);
  }

  private register(agent: SpecialistAgent) {
    this.agents.set(agent.key, agent);
  }

  async handle(question: string, intent: Intent, ctx: ToolContext): Promise<AgentOutcome> {
    const agent = await this.choose(question, intent);
    if (!agent) {
      return {
        answer: 'لا يوجد وكيل مسجَّل يستطيع الإجابة عن هذا السؤال بعد.',
        failed: true,
      };
    }
    return this.runner.run(agent, question, ctx);
  }

  private async choose(question: string, intent: Intent): Promise<SpecialistAgent | undefined> {
    const candidates = [...this.agents.values()];
    if (candidates.length === 0) return undefined;
    // With one specialist registered there is no choice to make, and a model
    // call that can only pick one option can only fail.
    if (candidates.length === 1) return candidates[0];

    const roster = candidates.map((a) => `- ${a.key}: ${a.description}`).join('\n');

    try {
      const result = await this.router.complete(
        AiTask.FAST,
        [
          { role: 'system', content: `${ORCHESTRATOR_PROMPT}\n\nالوكلاء:\n${roster}` },
          {
            role: 'user',
            // The gate's keyword read is offered as a suggestion, not an order:
            // keywords are wrong often enough not to be the last word.
            content: `السؤال: ${question}\n(ترجيح مبدئي من البوابة: ${intent})`,
          },
        ],
        { jsonMode: true, temperature: 0 },
      );

      const key = JSON.parse(result.content)?.agent;
      if (this.agents.has(key)) return this.agents.get(key);
      this.logger.warn(`orchestrator named unknown agent "${key}" — falling back`);
    } catch (error) {
      this.logger.warn(`orchestrator routing failed: ${classifyProviderFailure(error).kind}`);
    }

    return this.fallbackFor(intent) ?? candidates[0];
  }

  /** Routing may fail; refusing to answer because of it would be worse. */
  private fallbackFor(intent: Intent): SpecialistAgent | undefined {
    const byIntent: Partial<Record<Intent, string>> = {
      change: 'action_agent',
      report: 'report_agent',
      read: 'sales_intelligence',
    };
    const key = byIntent[intent];
    return key ? this.agents.get(key) : undefined;
  }
}
