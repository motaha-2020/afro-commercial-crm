import { Injectable, Logger } from '@nestjs/common';
import { AiRouterService } from '../ai-router.service';
import { AiTask } from '../ai.types';
import { classifyProviderFailure } from '../errors/provider-error';
import { SHARED_AGENT_RULES } from './shared-rules';
import type { AgentTool, SpecialistAgent, ToolContext } from './agent.types';
import type { AiMessage } from '../providers/ai-provider.interface';

/**
 * A model that keeps calling tools is a model that has lost the thread; five
 * rounds is more than any question here needs and stops a loop from burning a
 * daily quota.
 */
const MAX_ROUNDS = 5;

export interface AgentOutcome {
  /** The agent's own words. Never shown before the output guard sees them. */
  answer: string;
  /** True when the turn ended in failure — such turns are never cached or dressed up. */
  failed: boolean;
}

@Injectable()
export class AgentRunnerService {
  private readonly logger = new Logger(AgentRunnerService.name);

  constructor(private readonly router: AiRouterService) {}

  async run(agent: SpecialistAgent, question: string, ctx: ToolContext): Promise<AgentOutcome> {
    const tools = agent.tools();
    const byName = new Map(tools.map((tool) => [tool.definition.name, tool]));

    const messages: AiMessage[] = [
      { role: 'system', content: `${agent.systemPrompt}\n\n${SHARED_AGENT_RULES}` },
      { role: 'user', content: question },
    ];

    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      let result;
      try {
        result = await this.router.complete(AiTask.BALANCED, messages, {
          tools: tools.map((tool) => tool.definition),
          temperature: 0.1,
        });
      } catch (error) {
        const failure = classifyProviderFailure(error);
        this.logger.error(`agent ${agent.key} failed (${failure.kind})`);
        // Carried out as a failure, in the user's language, with no pretence
        // that anything is still in progress.
        return { answer: `تعذّر إكمال الطلب. ${failure.advice} لم يُنفَّذ أي تغيير.`, failed: true };
      }

      if (!result.toolCalls?.length) {
        const answer = result.content.trim();
        if (answer) return { answer, failed: false };
        // A model that returns neither an answer nor a tool call has stopped
        // working; saying so beats returning an empty bubble.
        return { answer: 'لم يُنتج المساعد إجابة. لم يُنفَّذ أي تغيير.', failed: true };
      }

      messages.push({
        role: 'assistant',
        content: result.content ?? '',
        toolCalls: result.toolCalls,
      });

      for (const call of result.toolCalls) {
        const payload = await this.invoke(byName.get(call.name), call.name, call.arguments, ctx);
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          content: JSON.stringify(payload),
        });
      }
    }

    return {
      answer: 'توقّف المساعد بعد عدة محاولات بلا إجابة نهائية. لم يُنفَّذ أي تغيير.',
      failed: true,
    };
  }

  private async invoke(
    tool: AgentTool | undefined,
    name: string,
    rawArgs: string,
    ctx: ToolContext,
  ): Promise<unknown> {
    if (!tool) {
      // Naming a tool that does not exist is the model inventing a path;
      // listing the real ones back is what gets it onto one.
      return { error: `لا توجد أداة باسم "${name}".` };
    }

    let args: Record<string, unknown>;
    try {
      args = rawArgs ? JSON.parse(rawArgs) : {};
    } catch {
      return { error: `وسائط الأداة "${name}" ليست JSON صالحًا.` };
    }

    try {
      return await tool.run(args, ctx);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`tool ${name} threw: ${reason}`);
      ctx.ledger.recordFailure(name, name);
      return { error: `فشل تنفيذ الأداة "${name}": ${reason}` };
    }
  }
}
