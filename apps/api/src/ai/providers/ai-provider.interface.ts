export interface AiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Set on assistant turns that requested tools, so the wire format can replay them. */
  toolCalls?: AiToolCall[];
  /** Set on `tool` turns — which call this result answers. */
  toolCallId?: string;
}

export interface AiToolCall {
  id: string;
  name: string;
  /** Raw JSON string as the model emitted it; callers parse and validate. */
  arguments: string;
}

export interface AiToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
}

export interface AiCompletionRequest {
  model: string;
  messages: AiMessage[];
  tools?: AiToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface AiCompletionResult {
  content: string;
  toolCalls?: AiToolCall[];
  provider: string;
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface AiProvider {
  readonly name: string;
  complete(request: AiCompletionRequest): Promise<AiCompletionResult>;
}
