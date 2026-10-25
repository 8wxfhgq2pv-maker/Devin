export interface HealthResponse {
  ok: boolean;
  service: string;
}

export interface OpenClawStatus {
  state: "not_configured" | "disconnected" | "connecting" | "connected" | "error";
  transport: string;
  endpoint?: string;
  serverVersion?: string;
  message?: string;
  targetAgentId?: string;
  targetSessionId?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { Accept: "application/json", ...init?.headers } });
  } catch {
    throw new Error("无法连接后端，请确认后端服务正在运行。");
  }
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = body && typeof body === "object" && "error" in body
      ? String((body as { error: unknown }).error)
      : `${res.status} ${res.statusText}`;
    throw new Error(error);
  }
  return body as T;
}

export const api = {
  health: () => request<HealthResponse>("/api/health"),
  openclawStatus: () => request<OpenClawStatus>("/api/openclaw/status"),
  openclawConnect: () => request<OpenClawStatus>("/api/openclaw/connect", { method: "POST" }),
};
