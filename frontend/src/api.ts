export interface HealthResponse {
  ok: boolean;
  service: string;
}

export type OpenClawConnectionState =
  | "not_configured"
  | "disconnected"
  | "connecting"
  | "pairing_required"
  | "connected"
  | "error";

export interface OpenClawStatus {
  state: OpenClawConnectionState;
  transport: string;
  endpoint?: string;
  serverVersion?: string;
  deviceId?: string;
  scopes?: string[];
  pairing?: { requestId?: string; deviceId: string; requestedScopes?: string[] };
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

export type OpenClawEvent =
  | { type: "status"; status: OpenClawStatus }
  | { type: "sessions.changed"; sessionKey?: string; reason?: string }
  | {
      type: "chat";
      sessionKey: string;
      runId: string;
      state: "status" | "delta" | "final" | "error" | "aborted";
      text?: string;
      phase?: string;
      errorMessage?: string;
    }
  | { type: "session.message"; sessionKey: string; message: OpenClawChatMessage }
  | { type: "approval"; approval: OpenClawApproval };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return body as T;
}

const base = "/api/openclaw";
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const sessionPath = (key: string) => `${base}/sessions/${encodeURIComponent(key)}`;

export const api = {
  health: () => request<HealthResponse>("/api/health"),
  status: () => request<OpenClawStatus>(`${base}/status`),
  connect: () => post<OpenClawStatus>(`${base}/connect`),
  disconnect: () => post<OpenClawStatus>(`${base}/disconnect`),
  sessions: () => request<{ sessions: OpenClawSession[] }>(`${base}/sessions`),
  createSession: () => post<OpenClawSession>(`${base}/sessions`),
  history: (key: string) => request<{ messages: OpenClawChatMessage[] }>(`${sessionPath(key)}/messages`),
  send: (key: string, message: string) => post<{ runId?: string }>(`${sessionPath(key)}/messages`, { message }),
  approvals: () => request<{ approvals: OpenClawApproval[] }>(`${base}/approvals`),
  resolveApproval: (id: string, decision: string) =>
    post<{ ok: true }>(`${base}/approvals/${encodeURIComponent(id)}/resolve`, { decision }),
  events: () => new EventSource(`${base}/events`),
};
