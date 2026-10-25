export interface OpenClawStatus {
  state: "not_configured" | "disconnected" | "connecting" | "connected" | "error";
  transport: string;
  endpoint?: string;
  serverVersion?: string;
  message?: string;
}
export interface Session { key: string; title: string; updatedAt?: number; model?: string; channel?: string }
export interface ChatMessage { id: string; role: "user" | "assistant"; content: string; timestamp?: number }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try { res = await fetch(path, { ...init, headers: { Accept: "application/json", ...init?.headers } }); }
  catch { throw new Error("无法连接后端，请确认 Devin 后端服务正在运行。"); }
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : `${res.status} ${res.statusText}`;
    throw new Error(error);
  }
  return body as T;
}
const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  status: () => request<OpenClawStatus>("/api/openclaw/status"),
  connect: () => request<OpenClawStatus>("/api/openclaw/connect", { method: "POST" }),
  sessions: async () => (await request<{ sessions: Session[] }>("/api/openclaw/sessions")).sessions,
  createSession: () => request<Session>("/api/openclaw/sessions", json({})),
  history: async (sessionKey: string) => (await request<{ messages: ChatMessage[] }>(`/api/openclaw/history?sessionKey=${encodeURIComponent(sessionKey)}`)).messages,
  send: (sessionKey: string, message: string, idempotencyKey: string) => request<{ runId?: string }>("/api/openclaw/messages", json({ sessionKey, message, idempotencyKey })),
  eventsUrl: (sessionKey: string) => `/api/openclaw/events?sessionKey=${encodeURIComponent(sessionKey)}`,
};
