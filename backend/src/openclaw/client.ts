/**
 * Transport-agnostic abstraction over the connection to OpenClaw.
 *
 * The concrete protocol is intentionally not implemented yet. Candidate
 * transports and protocol details are described in docs/openclaw-research.md.
 */

export type OpenClawConnectionState =
  | "not_configured"
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface OpenClawStatus {
  state: OpenClawConnectionState;
  transport: string;
  endpoint?: string;
  serverVersion?: string;
  /** Safe, actionable diagnostic. Never contains credentials. */
  message?: string;
  targetAgentId?: string;
  targetSessionId?: string;
}

export interface OpenClawChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface OpenClawSendMessageRequest {
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
  onEvent(listener: OpenClawEventListener): () => void;
}

export class OpenClawNotImplementedError extends Error {
  constructor(operation: string) {
    super(`OpenClaw ${operation} is not implemented yet. Configure the Gateway protocol and pairing first (see docs/openclaw-research.md).`);
    this.name = "OpenClawNotImplementedError";
  }
}

export interface OpenClawClientConfig {
  url?: string;
  token?: string;
  agentId?: string;
  sessionId?: string;
}

/** Strips userinfo, query string and fragment so credentials are never echoed back. */
export function redactEndpoint(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return "(invalid URL)";
  }
}

/** Placeholder used until the OpenClaw protocol is confirmed. */
export class PlaceholderOpenClawClient implements OpenClawClient {
  constructor(private readonly config: OpenClawClientConfig) {}

  async connect(): Promise<void> {
    throw new OpenClawNotImplementedError("connect");
  }

  async disconnect(): Promise<void> {}

  getStatus(): OpenClawStatus {
    const configured = Boolean(this.config.url);
    return {
      state: configured ? "disconnected" : "not_configured",
      transport: "not_implemented",
      endpoint: redactEndpoint(this.config.url),
      targetAgentId: this.config.agentId,
      targetSessionId: this.config.sessionId,
      message: configured
        ? "Gateway URL is configured, but no protocol client is active yet."
        : "Set OPENCLAW_URL to configure a Gateway. Connection protocol is not implemented yet.",
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
