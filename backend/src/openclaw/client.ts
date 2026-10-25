import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { GatewayClient, type DeviceIdentity, type GatewayClientHostDeps } from "@openclaw/gateway-client";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";

export type OpenClawConnectionState = "not_configured" | "disconnected" | "connecting" | "connected" | "error";
export interface OpenClawStatus {
  state: OpenClawConnectionState;
  transport: string;
  endpoint?: string;
  serverVersion?: string;
  message?: string;
}
export interface OpenClawSession {
  key: string;
  title: string;
  updatedAt?: number;
  model?: string;
  channel?: string;
}
export interface OpenClawMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
}
export interface OpenClawEvent { event: string; payload: unknown }
export type OpenClawEventListener = (event: OpenClawEvent) => void;

type AuthState = { identity?: DeviceIdentity; tokens?: Record<string, { token: string; scopes: string[] }> };
export interface OpenClawClientConfig { url?: string; token?: string; password?: string; statePath?: string }

export function redactEndpoint(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return "(invalid URL)";
  }
}

function publicKeyRawBase64Url(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return der.subarray(-32).toString("base64url");
}

async function readAuthState(path: string): Promise<AuthState> {
  try { return JSON.parse(await readFile(path, "utf8")) as AuthState; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Cannot read OpenClaw device state at ${path}`);
  }
}

async function writeAuthState(path: string, state: AuthState): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(state, null, 2), { mode: 0o600 });
  await chmod(path, 0o600);
}

function newIdentity(): DeviceIdentity {
  const pair = generateKeyPairSync("ed25519");
  const privateKeyPem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  return {
    deviceId: createHash("sha256").update(Buffer.from(publicKeyRawBase64Url(publicKeyPem), "base64url")).digest("hex"),
    privateKeyPem,
    publicKeyPem,
  };
}

export class OpenClawNotImplementedError extends Error {
  constructor(operation: string) {
    super(`OpenClaw ${operation} requires OPENCLAW_URL and a compatible Gateway.`);
    this.name = "OpenClawNotImplementedError";
  }
}

export class GatewayOpenClawClient {
  private gateway?: GatewayClient;
  private status: OpenClawStatus;
  private readonly listeners = new Set<OpenClawEventListener>();
  private connectPromise?: Promise<void>;
  private readonly statePath: string;

  constructor(private readonly config: OpenClawClientConfig) {
    this.statePath = config.statePath ?? join(process.cwd(), ".data", "openclaw-device.json");
    this.status = {
      state: config.url ? "disconnected" : "not_configured",
      transport: "@openclaw/gateway-client@2026.8.1",
      endpoint: redactEndpoint(config.url),
      message: config.url ? "Gateway 尚未连接。" : "请在后端配置 OPENCLAW_URL。",
    };
  }

  getStatus(): OpenClawStatus { return { ...this.status }; }
  onEvent(listener: OpenClawEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async connect(): Promise<void> {
    if (!this.config.url) throw new OpenClawNotImplementedError("connect");
    if (this.status.state === "connected") return;
    if (this.connectPromise) return this.connectPromise;
    this.status = { ...this.status, state: "connecting", message: "正在连接 OpenClaw Gateway…" };
    this.connectPromise = this.startGateway();
    try { await this.connectPromise; }
    finally { this.connectPromise = undefined; }
  }

  private async startGateway(): Promise<void> {
    const auth = await readAuthState(this.statePath);
    if (!auth.identity) {
      auth.identity = newIdentity();
      await writeAuthState(this.statePath, auth);
    }
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    const ready = new Promise<void>((resolve, reject) => {
      const done = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        error ? reject(error) : resolve();
      };
      timeout = setTimeout(() => done(new Error("连接 Gateway 超时，请检查地址和网络。")), 15_000);
      const hostDeps: GatewayClientHostDeps = {
        loadOrCreateDeviceIdentity: () => auth.identity,
        signDevicePayload: (privateKeyPem, payload) => sign(null, Buffer.from(payload), createPrivateKey(privateKeyPem)).toString("base64url"),
        publicKeyRawBase64UrlFromPem: publicKeyRawBase64Url,
        loadDeviceAuthToken: ({ role }) => auth.tokens?.[role] ?? null,
        storeDeviceAuthToken: ({ role, token, scopes }) => {
          auth.tokens = { ...auth.tokens, [role]: { token, scopes } };
          void writeAuthState(this.statePath, auth);
        },
        clearDeviceAuthToken: ({ role }) => {
          if (auth.tokens) delete auth.tokens[role];
          void writeAuthState(this.statePath, auth);
        },
        logDebug: () => {},
        logError: (message) => { if (!settled) done(new Error(message)); },
      };
      this.gateway = new GatewayClient({
        url: this.config.url,
        token: this.config.token,
        password: this.config.password,
        role: "operator",
        scopes: ["operator.read", "operator.write"],
        clientName: "webchat",
        clientDisplayName: "Devin OpenClaw UI",
        clientVersion: "0.1.0",
        platform: process.platform,
        mode: "webchat",
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        deviceIdentity: auth.identity,
        hostDeps,
        onHelloOk: (hello) => {
          this.status = {
            state: "connected",
            transport: "Gateway WebSocket",
            endpoint: redactEndpoint(this.config.url),
            serverVersion: hello.server?.version,
            message: "已连接 OpenClaw Gateway。",
          };
          done();
        },
        onConnectError: (error) => {
          this.status = { ...this.status, state: "error", message: error.message };
          done(error);
          this.emit({ event: "connection.error", payload: { message: error.message } });
        },
        onClose: (_code, reason) => {
          this.status = { ...this.status, state: "disconnected", message: reason || "Gateway 连接已断开。" };
          this.emit({ event: "connection.closed", payload: { reason } });
        },
        onEvent: (event) => this.emit({ event: event.event, payload: event.payload }),
      });
      this.gateway.start();
    });
    try { await ready; }
    catch (error) {
      this.gateway?.stop();
      this.gateway = undefined;
      this.status = { ...this.status, state: "error", message: error instanceof Error ? error.message : String(error) };
      throw error;
    }
  }

  private emit(event: OpenClawEvent): void { for (const listener of this.listeners) listener(event); }
  private async readyClient(): Promise<GatewayClient> {
    if (!this.gateway || this.status.state !== "connected") await this.connect();
    if (!this.gateway || this.status.state !== "connected") throw new Error(this.status.message ?? "Gateway is not connected");
    return this.gateway;
  }

  async listSessions(): Promise<OpenClawSession[]> {
    const client = await this.readyClient();
    const result = await client.request<{ sessions?: Array<Record<string, unknown>> }>("sessions.list", { limit: 100, includeDerivedTitles: true });
    return (result.sessions ?? []).flatMap((row) => {
      if (typeof row.key !== "string") return [];
      return [{
        key: row.key,
        title: String(row.derivedTitle ?? row.displayName ?? row.label ?? row.key),
        ...(typeof row.updatedAt === "number" ? { updatedAt: row.updatedAt } : {}),
        ...(typeof row.model === "string" ? { model: row.model } : {}),
        ...(typeof row.channel === "string" ? { channel: row.channel } : {}),
      }];
    });
  }

  async getHistory(sessionKey: string, limit = 80): Promise<OpenClawMessage[]> {
    const client = await this.readyClient();
    const result = await client.request<{ messages?: Array<Record<string, unknown>> }>("chat.history", { sessionKey, limit });
    return (result.messages ?? []).flatMap((row, index) => {
      if (row.role !== "user" && row.role !== "assistant") return [];
      const content = typeof row.content === "string" ? row.content : Array.isArray(row.content)
        ? row.content.map((part) => part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : "[附件]").join("")
        : "";
      return [{ id: String(row.id ?? `${row.role}-${row.timestamp ?? index}`), role: row.role, content, ...(typeof row.timestamp === "number" ? { timestamp: row.timestamp } : {}) }];
    });
  }

  async createSession(): Promise<OpenClawSession> {
    const client = await this.readyClient();
    const result = await client.request<Record<string, unknown>>("sessions.create", {});
    const key = String(result.key ?? result.sessionKey ?? result.sessionId ?? "");
    if (!key) throw new Error("Gateway 创建会话后没有返回会话标识。");
    return { key, title: String(result.title ?? "新对话") };
  }

  async sendMessage(params: { sessionKey: string; message: string; idempotencyKey: string }): Promise<{ runId?: string }> {
    const client = await this.readyClient();
    return client.request("chat.send", params, { expectFinal: false });
  }

  async disconnect(): Promise<void> {
    await this.gateway?.stopAndWait({ timeoutMs: 1000 });
    this.gateway = undefined;
    this.status = { ...this.status, state: this.config.url ? "disconnected" : "not_configured" };
  }
}

export function createOpenClawClient(config: OpenClawClientConfig): GatewayOpenClawClient {
  return new GatewayOpenClawClient(config);
}
