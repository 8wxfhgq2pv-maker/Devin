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
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return body as T;
}

export const api = {
  health: () => request<HealthResponse>("/api/health"),
  openclawStatus: () => request<OpenClawStatus>("/api/openclaw/status"),
  openclawConnect: () => request<OpenClawStatus>("/api/openclaw/connect", { method: "POST" }),
};
