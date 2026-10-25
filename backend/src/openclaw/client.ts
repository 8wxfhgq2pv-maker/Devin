/**
 * Transport-agnostic contract between the HTTP routes and OpenClaw.
 *
 * The only implementation today is `GatewayOpenClawClient` (Gateway WebSocket
 * protocol v4, see docs/openclaw-research.md). Routes depend on this interface
 * so the transport can be swapped without touching them.
 */

export type OpenClawConnectionState =
  | "not_configured"
  | "disconnected"
  | "connecting"
  | "pairing_required"
  | "connected"
  | "error";

export interface OpenClawPairingInfo {
  requestId?: string;
  deviceId: string;
  requestedScopes?: string[];
}

export interface OpenClawStatus {
  state: OpenClawConnectionState;
  transport: string;
  endpoint?: string;
  serverVersion?: string;
  deviceId?: string;
  scopes?: string[];
  pairing?: OpenClawPairingInfo;
  message?: string;
}

export interface OpenClawSession {
  key: string;
  title: string;
  updatedAt?: number;
  lastMessagePreview?: string;
  hasActiveRun?: boolean;
}

export interface OpenClawChatMessage {
  id?: string;
  role: string;
  text: string;
  timestamp?: number;
  runId?: string;
}

export interface OpenClawApproval {
  id: string;
  kind: string;
  status: string;
  summary: string;
  warning?: string;
  allowedDecisions: string[];
  sessionKey?: string;
  expiresAtMs?: number;
}

export type OpenClawChatRunState = "status" | "delta" | "final" | "error" | "aborted";

export type OpenClawEvent =
  | { type: "status"; status: OpenClawStatus }
  | { type: "sessions.changed"; sessionKey?: string; reason?: string }
  | {
      type: "chat";
      sessionKey: string;
      runId: string;
      state: OpenClawChatRunState;
      text?: string;
      phase?: string;
      errorMessage?: string;
    }
  | { type: "session.message"; sessionKey: string; message: OpenClawChatMessage }
  | { type: "approval"; approval: OpenClawApproval };

export type OpenClawEventListener = (event: OpenClawEvent) => void;

export interface OpenClawSendMessageRequest {
  sessionKey: string;
  message: string;
}

export interface OpenClawSendMessageResult {
  runId?: string;
}

export interface OpenClawClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): OpenClawStatus;
  listSessions(): Promise<OpenClawSession[]>;
  createSession(): Promise<OpenClawSession>;
  getHistory(sessionKey: string): Promise<OpenClawChatMessage[]>;
  sendMessage(request: OpenClawSendMessageRequest): Promise<OpenClawSendMessageResult>;
  listApprovals(): OpenClawApproval[];
  resolveApproval(id: string, decision: string): Promise<void>;
  onEvent(listener: OpenClawEventListener): () => void;
}

/** Maps to an HTTP status in the error middleware. */
export class OpenClawError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "OpenClawError";
  }
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
