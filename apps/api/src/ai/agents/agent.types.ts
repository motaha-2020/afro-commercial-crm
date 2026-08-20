import type { AuthenticatedUser } from '../../auth/auth.types';
import type { EvidenceLedger } from '../evidence/evidence-ledger';
import type { AiToolDefinition } from '../providers/ai-provider.interface';

/**
 * Something the turn produced that a screen should render as itself rather
 * than as a sentence: a file to download, a change waiting on a code.
 *
 * Collected from the tools, never parsed out of the model's prose. The model
 * once turned a relative report path into "https://example.com/..." -- it had
 * to write a host and did not have one, so it invented it. A card built from
 * what the tool actually returned cannot go wrong that way.
 */
export type TurnArtifact =
  | {
      kind: 'report';
      filename: string;
      /** Server-relative. The browser knows its own origin; the model does not. */
      url: string;
      rowCount: number;
      sizeBytes?: number;
    }
  | {
      kind: 'proposal';
      action: string;
      targetCode: string;
      changes: { field: string; value: unknown }[];
      expiresAt: string;
    };

/** Everything a tool is allowed to know about the turn it runs in. */
export interface ToolContext {
  /** Whose permissions the read runs under. There is no service account. */
  user: AuthenticatedUser;
  ledger: EvidenceLedger;
  conversationId?: string;
  /** Tools push here what the screen should show as a control, not as text. */
  artifacts: TurnArtifact[];
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
