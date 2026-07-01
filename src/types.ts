export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content:
    | string
    | Array<{
        type: string;
        text?: string;
        input_text?: string;
        output_text?: string;
      }>;
}

export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
}

export interface ResponsesRequest {
  model?: string;
  input?: unknown;
  instructions?: string;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
}

export interface BridgeModel {
  id: string;
  name: string;
}

export interface CursorRunOptions {
  model: string;
  prompt: string;
  cwd?: string;
  signal?: AbortSignal;
}

export interface CursorRunResult {
  text: string;
  model: string;
}

export interface CursorRunEvents {
  onDelta?: (text: string) => void;
  onModel?: (model: string) => void;
}

export interface ServerConfig {
  port?: number;
  host?: string;
  agentPath?: string;
  defaultCwd?: string;
  maxBodyBytes?: number;
}
