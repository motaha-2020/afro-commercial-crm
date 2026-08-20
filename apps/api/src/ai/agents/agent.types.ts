import type { AuthenticatedUser } from '../../auth/auth.types';
import type { EvidenceLedger } from '../evidence/evidence-ledger';
import type { AiToolDefinition } from '../providers/ai-provider.interface';

/** Everything a tool is allowed to know about the turn it runs in. */
export interface ToolContext {
  /** Whose permissions the read runs under. There is no service account. */
  user: AuthenticatedUser;
  ledger: EvidenceLedger;
  conversationId?: string;
}

/**
 * A tool is an in-process function, never an HTTP call. That is the whole
 * reason the identity layer disappears: the caller already holds the user.
 */
export interface AgentTool {
  definition: AiToolDefinition;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
}

export interface SpecialistAgent {
  readonly key: string;
  /** Shown to the orchestrator so it can choose. */
  readonly description: string;
  readonly systemPrompt: string;
  tools(): AgentTool[];
}

/** What a tool returns when it fails. The model is told never to paper over it. */
export function toolError(message: string): { error: string } {
  return { error: message };
}
