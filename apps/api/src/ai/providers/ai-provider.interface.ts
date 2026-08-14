export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiCompletionRequest {
  model: string;
  messages: AiMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface AiCompletionResult {
  content: string;
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
