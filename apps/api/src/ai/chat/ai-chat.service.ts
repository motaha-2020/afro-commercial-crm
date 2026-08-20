import { Injectable, Logger } from '@nestjs/common';
import { AiMemoryService } from '../memory/ai-memory.service';
import { IntentGateService } from '../gate/intent-gate.service';
import { OrchestratorService } from '../agents/orchestrator.service';
import { PendingActionService } from '../pending/pending-action.service';
import { ActionExecutorService } from '../agents/action-executor.service';
import { EvidenceLedger } from '../evidence/evidence-ledger';
import { guardOutput } from '../guard/output-guard';
import type { AuthenticatedUser } from '../../auth/auth.types';

export interface ChatReply {
  conversationId: string;
  answer: string;
  /** Built from the ledger, never from the model's words. */
  sources?: string;
  flagged: boolean;
  failed: boolean;
}

/**
 * One turn, in order: gate, agent, guard, sources, memory.
 *
 * The order is the design. The gate runs before any model so a confirmation
 * never depends on one; the guard runs after every answer so nothing reaches a
 * person unchecked; and memory is written last so a turn that failed or was
 * flagged is never stored to be replayed after its cause is gone.
 */
@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name);

  constructor(
    private readonly gate: IntentGateService,
    private readonly orchestrator: OrchestratorService,
    private readonly pending: PendingActionService,
    private readonly executor: ActionExecutorService,
    private readonly memory: AiMemoryService,
  ) {}

  async send(
    user: AuthenticatedUser,
    message: string,
    conversationId?: string,
  ): Promise<ChatReply> {
    const conversation = await this.memory.startOrGetConversation(user.id, conversationId);
    const decision = this.gate.decide(message);

    if (decision.kind === 'confirmation') {
      // No model on this path at all: a write must not hang on a probabilistic
      // step, and there is nothing here for one to decide.
      const result = await this.pending.claim(user, decision.code, (u, action, targetId, body) =>
        this.executor.execute(u, action, targetId, body),
      );

      // Confirmations and their replies are never written to memory.
      return {
        conversationId: conversation.id,
        answer: result.message,
        flagged: false,
        failed: !result.ok,
      };
    }

    const ledger = new EvidenceLedger();
    const outcome = await this.orchestrator.handle(message, decision.intent, {
      user,
      ledger,
      conversationId: conversation.id,
    });

    const guarded = guardOutput(outcome.answer, ledger, message);
    if (guarded.flagged) {
      this.logger.warn(`output guard flagged a reply: ${guarded.reasons.join(', ')}`);
    }

    // Storing a failure lets it outlive its cause; storing a flagged answer
    // preserves exactly the text the guard objected to.
    if (!outcome.failed && !guarded.flagged) {
      await this.memory.appendUserMessage(conversation.id, message);
      await this.memory.appendAssistantMessage(conversation.id, guarded.text, {
        task: 'balanced',
        provider: 'router',
        model: 'router',
      });
    }

    return {
      conversationId: conversation.id,
      answer: guarded.text,
      sources: ledger.sourceLine(),
      flagged: guarded.flagged,
      failed: outcome.failed,
    };
  }
}
