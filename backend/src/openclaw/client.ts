/**
 * Transport-agnostic abstraction over the connection to OpenClaw.
 *
 * The concrete protocol is intentionally NOT implemented yet. Candidate
 * transports (Gateway WebSocket RPC, OpenAI-compatible HTTP, CLI) are
 * described in docs/openclaw-research.md; pick one there before filling in
 * an implementation of this interface.
 */

export type OpenClawConnectionState =
  | "not_configured"
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface OpenClawStatus {
  state: OpenClawConnectionState;
  /** Which implementation is active, e.g. "placeholder". */
  transport: string;
  /** Remote endpoint, if configured. Never includes credentials. */
  endpoint?: string;
  /** Server version reported by OpenClaw after connecting, if known. */
  serverVersion?: string;
  message?: string;
}

export interface OpenClawChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface OpenClawSendMessageRequest {
  /** Target conversation/session; semantics depend on the chosen transport. */
  sessionId?: string;
  message: string;
}

export interface OpenClawSendMessageResult {
  sessionId?: string;
  reply?: OpenClawChatMessage;
}

export interface OpenClawEvent {
  type: string;
  payload: unknown;
}

export type OpenClawEventListener = (event: OpenClawEvent) => void;

export interface OpenClawClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): OpenClawStatus;
  sendMessage(request: OpenClawSendMessageRequest): Promise<OpenClawSendMessageResult>;
  /** Subscribe to server-pushed events. Returns an unsubscribe function. */
  onEvent(listener: OpenClawEventListener): () => void;
}

export class OpenClawNotImplementedError extends Error {
  constructor(operation: string) {
    super(
      `OpenClaw ${operation} is not implemented yet: the connection protocol has not been confirmed (see docs/openclaw-research.md).`,
    );
    this.name = "OpenClawNotImplementedError";
  }
}

export interface OpenClawClientConfig {
  url?: string;
  token?: string;
}

/** Placeholder used until the OpenClaw protocol is confirmed. */
export class PlaceholderOpenClawClient implements OpenClawClient {
  constructor(private readonly config: OpenClawClientConfig) {}

  async connect(): Promise<void> {
    throw new OpenClawNotImplementedError("connect");
  }

  async disconnect(): Promise<void> {}

  getStatus(): OpenClawStatus {
    return {
      state: this.config.url ? "disconnected" : "not_configured",
      transport: "placeholder",
      endpoint: this.config.url || undefined,
      message: "Connection logic pending protocol confirmation.",
    };
  }

  async sendMessage(): Promise<OpenClawSendMessageResult> {
    throw new OpenClawNotImplementedError("sendMessage");
  }

  onEvent(): () => void {
    return () => {};
  }
}

export function createOpenClawClient(config: OpenClawClientConfig): OpenClawClient {
  return new PlaceholderOpenClawClient(config);
}
