import { randomUUID } from "node:crypto";
import { GatewayClient } from "@openclaw/gateway-client";
import type { OpenClawConfig } from "../config.js";
import {
  OpenClawError,
  redactEndpoint,
  type OpenClawApproval,
  type OpenClawChatMessage,
  type OpenClawChatRunState,
  type OpenClawClient,
  type OpenClawEvent,
  type OpenClawEventListener,
  type OpenClawSendMessageRequest,
  type OpenClawSendMessageResult,
  type OpenClawSession,
  type OpenClawStatus,
} from "./client.js";
import { DeviceStore, publicKeyRawBase64Url, signPayload } from "./device-store.js";

const ROLE = "operator";
const SCOPES = ["operator.read", "operator.write", "operator.approvals"];
const CAPS = ["approvals", "exec-approvals", "plugin-approvals"];
const PAIRING_RETRY_MS = 5_000;
const SESSION_LIST_LIMIT = 50;

type Json = Record<string, unknown>;

const asRecord = (value: unknown): Json =>
  value && typeof value === "object" ? (value as Json) : {};
const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;
const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;

/** Flattens OpenClaw message content (string or content blocks) to display text. */
export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const b = asRecord(block);
      if (b.type === "text") return asString(b.text) ?? "";
      if (b.type === "image") return "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function toChatMessage(raw: unknown): OpenClawChatMessage {
  const m = asRecord(raw);
  const meta = asRecord(m.__openclaw);
  return {
    id: asString(meta.id),
    role: asString(m.role) ?? "unknown",
    text: messageText(m.content),
    timestamp: asNumber(m.timestamp),
    runId: asString(meta.runId),
  };
}

function toSession(raw: unknown): OpenClawSession | undefined {
  const row = asRecord(raw);
  const key = asString(row.key) ?? asString(row.sessionKey);
  if (!key) return undefined;
  return {
    key,
    title: asString(row.displayName) ?? asString(row.derivedTitle) ?? asString(row.label) ?? key,
    updatedAt: asNumber(row.updatedAt),
    lastMessagePreview: asString(row.lastMessagePreview),
    hasActiveRun: typeof row.hasActiveRun === "boolean" ? row.hasActiveRun : undefined,
  };
}

/** Normalizes approval snapshots from list responses and the various approval events. */
export function toApproval(raw: unknown, fallbackKind = "exec"): OpenClawApproval | undefined {
  const snapshot = asRecord(raw);
  const approval = snapshot.approval ? asRecord(snapshot.approval) : snapshot;
  const id = asString(approval.id);
  if (!id) return undefined;
  const presentation = asRecord(approval.presentation);
  const request = asRecord(approval.request);
  const kind = asString(presentation.kind) ?? asString(approval.kind) ?? fallbackKind;
  const decisions = Array.isArray(presentation.allowedDecisions)
    ? presentation.allowedDecisions.filter((d): d is string => typeof d === "string")
    : [];
  return {
    id,
    kind,
    status: asString(approval.status) ?? (approval.decision ? "resolved" : "pending"),
    summary:
      asString(presentation.commandText) ??
      asString(presentation.title) ??
      asString(request.command) ??
      asString(request.title) ??
      asString(approval.command) ??
      asString(approval.title) ??
      `${kind} approval`,
    warning: asString(presentation.warningText) ?? asString(request.warningText),
    allowedDecisions: decisions.length ? decisions : ["allow-once", "deny"],
    sessionKey:
      asString(snapshot.sessionKey) ??
      asString(snapshot.sourceSessionKey) ??
      asString(asRecord(approval.source).sessionKey) ??
      asString(request.sessionKey),
    expiresAtMs: asNumber(approval.expiresAtMs),
  };
}

/**
 * OpenClaw Gateway WebSocket (protocol v4) client built on the official
 * `@openclaw/gateway-client`. The backend acts as one paired operator device:
 * the shared Gateway token/password bootstraps pairing, after which the issued
 * device token is persisted in the state directory and reused.
 */
export class GatewayOpenClawClient implements OpenClawClient {
  private client?: GatewayClient;
  private status: OpenClawStatus;
  private readonly listeners = new Set<OpenClawEventListener>();
  private readonly store: DeviceStore;
  private readonly sessions = new Map<string, OpenClawSession>();
  private readonly approvals = new Map<string, OpenClawApproval>();
  /** Sessions the UI has opened; replayed after every (re)connect. */
  private readonly desiredSubscriptions = new Set<string>();
  /** Subscriptions active on the current Gateway connection. */
  private readonly messageSubscriptions = new Set<string>();
  /** Approval ids touched by live events while a reconnect snapshot is in flight. */
  private approvalEventsDuringBootstrap?: Set<string>;
  private readonly runText = new Map<string, string>();
  private pairingTimer?: NodeJS.Timeout;
  private wantConnected = false;

  constructor(private readonly config: OpenClawConfig) {
    this.store = new DeviceStore(config.stateDir);
    this.status = config.url
      ? { state: "disconnected", transport: "gateway-ws-v4", endpoint: redactEndpoint(config.url) }
      : {
          state: "not_configured",
          transport: "gateway-ws-v4",
          message: "Set OPENCLAW_URL (and OPENCLAW_TOKEN or OPENCLAW_PASSWORD) in backend/.env.",
        };
  }

  getStatus(): OpenClawStatus {
    return this.status;
  }

  async connect(): Promise<void> {
    if (!this.config.url) {
      throw new OpenClawError("OPENCLAW_URL is not configured", 400, "NOT_CONFIGURED");
    }
    try {
      new URL(this.config.url);
    } catch {
      throw new OpenClawError("OPENCLAW_URL is not a valid URL", 400, "INVALID_URL");
    }
    this.wantConnected = true;
    this.startClient();
  }

  async disconnect(): Promise<void> {
    this.wantConnected = false;
    this.clearPairingTimer();
    await this.stopClient();
    this.setStatus({ state: "disconnected", transport: "gateway-ws-v4", endpoint: this.status.endpoint });
  }

  async listSessions(): Promise<OpenClawSession[]> {
    const result = asRecord(
      await this.request("sessions.list", {
        limit: SESSION_LIST_LIMIT,
        includeDerivedTitles: true,
        includeLastMessage: true,
      }),
    );
    this.replaceSessions(result.sessions);
    return [...this.sessions.values()];
  }

  async createSession(): Promise<OpenClawSession> {
    const result = asRecord(await this.request("sessions.create", {}));
    const key = asString(result.key);
    if (!key) throw new OpenClawError("Gateway did not return a session key", 502);
    const session = toSession({ key, ...asRecord(result.entry) }) ?? { key, title: key };
    this.sessions.set(key, session);
    return session;
  }

  async getHistory(sessionKey: string): Promise<OpenClawChatMessage[]> {
    await this.subscribeMessages(sessionKey);
    const result = asRecord(await this.request("chat.history", { sessionKey, limit: 200 }));
    return Array.isArray(result.messages) ? result.messages.map(toChatMessage) : [];
  }

  async sendMessage({ sessionKey, message }: OpenClawSendMessageRequest): Promise<OpenClawSendMessageResult> {
    await this.subscribeMessages(sessionKey);
    const result = asRecord(
      await this.request("chat.send", { sessionKey, message, idempotencyKey: randomUUID() }),
    );
    return { runId: asString(result.runId) };
  }

  listApprovals(): OpenClawApproval[] {
    return [...this.approvals.values()].filter((a) => a.status === "pending");
  }

  async resolveApproval(id: string, decision: string): Promise<void> {
    const approval = this.approvals.get(id);
    if (!approval) throw new OpenClawError("Unknown approval id", 404, "UNKNOWN_APPROVAL");
    if (!approval.allowedDecisions.includes(decision)) {
      throw new OpenClawError(`Decision must be one of: ${approval.allowedDecisions.join(", ")}`, 400);
    }
    await this.request("approval.resolve", { id, kind: approval.kind, decision });
    this.upsertApproval({ ...approval, status: decision === "deny" ? "denied" : "allowed" });
  }

  onEvent(listener: OpenClawEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private startClient(): void {
    this.clearPairingTimer();
    void this.stopClient();
    const identity = this.store.loadOrCreateIdentity();
    const endpoint = redactEndpoint(this.config.url);
    const tokenKey = (deviceId: string, role: string) => `${endpoint}|${deviceId}|${role}`;
    this.setStatus({ state: "connecting", transport: "gateway-ws-v4", endpoint, deviceId: identity.deviceId });

    const client: GatewayClient = new GatewayClient({
      url: this.config.url,
      token: this.config.token,
      password: this.config.password,
      clientName: "gateway-client",
      clientDisplayName: "OpenClaw Web UI",
      clientVersion: "0.1.0",
      platform: process.platform,
      mode: "backend",
      role: ROLE,
      scopes: SCOPES,
      caps: CAPS,
      deviceIdentity: identity,
      hostDeps: {
        signDevicePayload: signPayload,
        publicKeyRawBase64UrlFromPem: publicKeyRawBase64Url,
        loadDeviceAuthToken: ({ deviceId, role }) => this.store.loadToken(tokenKey(deviceId, role)),
        storeDeviceAuthToken: ({ deviceId, role, token, scopes, expectedToken }) =>
          this.store.storeToken(tokenKey(deviceId, role), { token, scopes }, expectedToken),
        clearDeviceAuthToken: ({ deviceId, role, expectedToken }) =>
          this.store.clearToken(tokenKey(deviceId, role), expectedToken),
        logError: (message) => console.warn(`[openclaw] ${message}`),
      },
      onHelloOk: (hello) => {
        if (this.client !== client) return;
        const auth = asRecord(hello.auth);
        this.setStatus({
          state: "connected",
          transport: "gateway-ws-v4",
          endpoint,
          deviceId: identity.deviceId,
          serverVersion: asString(asRecord(hello.server).version),
          scopes: Array.isArray(auth.scopes) ? (auth.scopes as string[]) : undefined,
        });
        void this.bootstrapAfterHello();
      },
      onConnectError: (err) => {
        if (this.client !== client) return;
        const details = asRecord((err as { details?: unknown }).details);
        if (details.code === "PAIRING_REQUIRED") {
          this.setStatus({
            state: "pairing_required",
            transport: "gateway-ws-v4",
            endpoint,
            deviceId: identity.deviceId,
            pairing: {
              requestId: asString(details.requestId),
              deviceId: asString(details.deviceId) ?? identity.deviceId,
              requestedScopes: Array.isArray(details.requestedScopes)
                ? (details.requestedScopes as string[])
                : SCOPES,
            },
            message: "Approve this device on the Gateway host: openclaw devices approve <requestId>",
          });
          return;
        }
        this.setStatus({
          state: "error",
          transport: "gateway-ws-v4",
          endpoint,
          deviceId: identity.deviceId,
          message: err.message,
        });
      },
      onReconnectPaused: (info) => {
        if (this.client !== client) return;
        if (info.detailCode === "PAIRING_REQUIRED" && this.wantConnected) {
          // The pending request is keyed by device + scopes, so retrying reuses it.
          this.pairingTimer = setTimeout(() => this.wantConnected && this.startClient(), PAIRING_RETRY_MS);
          return;
        }
        this.setStatus({
          ...this.status,
          state: "error",
          message: info.reason || `Gateway closed the connection (${info.detailCode ?? info.code})`,
        });
      },
      onClose: () => {
        if (this.client !== client || this.status.state !== "connected") return;
        this.messageSubscriptions.clear();
        this.setStatus({ ...this.status, state: "connecting", message: "Reconnecting to Gateway…" });
      },
      onEvent: (frame) => {
        if (this.client === client) this.handleEvent(frame.event, frame.payload);
      },
    });
    this.client = client;
    client.start();
  }

  private async stopClient(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.messageSubscriptions.clear();
    if (client) await client.stopAndWait().catch(() => undefined);
  }

  private clearPairingTimer(): void {
    if (this.pairingTimer) clearTimeout(this.pairingTimer);
    this.pairingTimer = undefined;
  }

  private async bootstrapAfterHello(): Promise<void> {
    try {
      const sub = asRecord(
        await this.request("sessions.subscribe", {
          limit: SESSION_LIST_LIMIT,
          includeDerivedTitles: true,
          includeLastMessage: true,
        }),
      );
      this.replaceSessions(asRecord(sub.list).sessions);
      this.emit({ type: "sessions.changed", reason: "bootstrap" });
    } catch (err) {
      console.warn(`[openclaw] sessions.subscribe failed: ${(err as Error).message}`);
    }
    for (const sessionKey of this.desiredSubscriptions) {
      await this.subscribeMessages(sessionKey).catch((err) =>
        console.warn(`[openclaw] resubscribe ${sessionKey} failed: ${(err as Error).message}`),
      );
    }
    await this.refreshApprovals();
  }

  /** Replaces the pending-approval cache with a fresh Gateway snapshot. */
  private async refreshApprovals(): Promise<void> {
    const touched = new Set<string>();
    this.approvalEventsDuringBootstrap = touched;
    const fetched = new Set<string>();
    let complete = true;
    try {
      for (const [method, kind] of [
        ["exec.approval.list", "exec"],
        ["plugin.approval.list", "plugin"],
      ] as const) {
        try {
          const list = await this.request(method, {});
          for (const item of Array.isArray(list) ? list : []) {
            const approval = toApproval(item, kind);
            if (!approval) continue;
            fetched.add(approval.id);
            if (!touched.has(approval.id)) this.upsertApproval(approval);
          }
        } catch (err) {
          complete = false;
          console.warn(`[openclaw] ${method} failed: ${(err as Error).message}`);
        }
      }
    } finally {
      this.approvalEventsDuringBootstrap = undefined;
    }
    if (!complete) return;
    for (const approval of [...this.approvals.values()]) {
      if (!fetched.has(approval.id) && !touched.has(approval.id)) {
        this.upsertApproval({ ...approval, status: "expired" });
      }
    }
  }

  private async subscribeMessages(sessionKey: string): Promise<void> {
    this.desiredSubscriptions.add(sessionKey);
    if (this.messageSubscriptions.has(sessionKey)) return;
    await this.request("sessions.messages.subscribe", { key: sessionKey, includeApprovals: true });
    this.messageSubscriptions.add(sessionKey);
  }

  private replaceSessions(rows: unknown): void {
    if (!Array.isArray(rows)) return;
    this.sessions.clear();
    for (const row of rows) {
      const session = toSession(row);
      if (session) this.sessions.set(session.key, session);
    }
  }

  private handleEvent(event: string, payload: unknown): void {
    const p = asRecord(payload);
    switch (event) {
      case "sessions.changed": {
        const session = toSession(p);
        if (session && p.reason !== "delete") {
          const prev = this.sessions.get(session.key);
          this.sessions.set(session.key, { ...prev, ...session, title: session.title !== session.key ? session.title : (prev?.title ?? session.title) });
        } else if (session) {
          this.sessions.delete(session.key);
        }
        this.emit({ type: "sessions.changed", sessionKey: asString(p.sessionKey), reason: asString(p.reason) });
        return;
      }
      case "session.message": {
        const sessionKey = asString(p.sessionKey);
        if (sessionKey && p.message) {
          this.emit({ type: "session.message", sessionKey, message: toChatMessage(p.message) });
        }
        return;
      }
      case "chat": {
        const sessionKey = asString(p.sessionKey);
        const runId = asString(p.runId);
        const state = asString(p.state) as OpenClawChatRunState | undefined;
        if (!sessionKey || !runId || !state) return;
        let text = this.runText.get(runId);
        if (p.message) text = messageText(asRecord(p.message).content);
        else if (typeof p.deltaText === "string") text = p.replace ? p.deltaText : (text ?? "") + p.deltaText;
        if (state === "final" || state === "error" || state === "aborted") this.runText.delete(runId);
        else if (text !== undefined) this.runText.set(runId, text);
        this.emit({
          type: "chat",
          sessionKey,
          runId,
          state,
          text,
          phase: asString(p.phase),
          errorMessage: asString(p.errorMessage),
        });
        return;
      }
      case "session.approval":
      case "exec.approval.requested":
      case "exec.approval.resolved":
      case "plugin.approval.requested":
      case "plugin.approval.resolved": {
        const approval = toApproval(p, event.startsWith("plugin.") ? "plugin" : "exec");
        if (!approval) return;
        if (event.endsWith(".resolved") && approval.status === "pending") approval.status = "resolved";
        this.approvalEventsDuringBootstrap?.add(approval.id);
        this.upsertApproval(approval);
        return;
      }
      default:
        return;
    }
  }

  private upsertApproval(approval: OpenClawApproval): void {
    const prev = this.approvals.get(approval.id);
    const merged = prev ? { ...prev, ...approval, sessionKey: approval.sessionKey ?? prev.sessionKey } : approval;
    if (merged.status === "pending") this.approvals.set(approval.id, merged);
    else this.approvals.delete(approval.id);
    this.emit({ type: "approval", approval: merged });
  }

  private async request(method: string, params: Json): Promise<unknown> {
    if (!this.client || this.status.state !== "connected") {
      throw new OpenClawError("Not connected to the OpenClaw Gateway", 409, "NOT_CONNECTED");
    }
    try {
      return await this.client.request(method, params);
    } catch (err) {
      const e = err as { message?: string; gatewayCode?: string };
      throw new OpenClawError(e.message ?? `${method} failed`, 502, e.gatewayCode);
    }
  }

  private setStatus(status: OpenClawStatus): void {
    this.status = status;
    this.emit({ type: "status", status });
  }

  private emit(event: OpenClawEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[openclaw] event listener failed", err);
      }
    }
  }
}
