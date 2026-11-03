import {
  createSessionProjection,
  hasSessionProjectionAcceptedFinal,
  reduceSessionProjection,
  reduceSessionProjectionRunEvent,
  type SessionProjectionGatewayRunEvent,
  type SessionProjectionState,
} from "@openclaw/gateway-client";

export interface ProjectionMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
  pending?: boolean;
}

export interface SerializedProjection {
  messages: ProjectionMessage[];
  streaming: boolean;
}

const MAX_TRACKED_SESSIONS = 32;
const RUN_PHASES = ["delta", "final", "error", "aborted"];

interface SessionEntry {
  projection: SessionProjectionState;
  /** Streamed text per run, for Gateways that send `deltaText` without a full message. */
  streams: Map<string, string>;
}

/** Returns strings unchanged, joins content parts with `[附件]` for parts without a text field, and returns an empty string for other values. */
export function messageContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : "[附件]")
      .join("");
  }
  return "";
}

function toMessage(raw: unknown, fallbackIndex: number): ProjectionMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const role = row.role;
  if (role !== "user" && role !== "assistant") return null;
  const content = messageContent(row.content);
  if (!content.trim()) return null;
  const metadata = row.__openclaw && typeof row.__openclaw === "object" ? row.__openclaw as Record<string, unknown> : {};
  const id = [row.id, row.messageId, metadata.id].find((value): value is string => typeof value === "string" && value.length > 0)
    ?? `${role}-${typeof row.timestamp === "number" ? row.timestamp : fallbackIndex}`;
  return {
    id,
    role,
    content,
    ...(typeof row.timestamp === "number" ? { timestamp: row.timestamp } : {}),
  };
}

/**
 * Keeps one OpenClaw session projection per session key and serializes it for the browser.
 * Identity, ordering, duplicate suppression and replay rules all come from the official
 * reducers in `@openclaw/gateway-client`; only `deltaText` accumulation is local, because the
 * Gateway sends streamed text as a delta rather than a whole message.
 */
export class SessionProjectionStore {
  private readonly sessions = new Map<string, SessionEntry>();

  private ensure(sessionKey: string): SessionEntry {
    const existing = this.sessions.get(sessionKey);
    if (existing) return existing;
    if (this.sessions.size >= MAX_TRACKED_SESSIONS) {
      const oldest = this.sessions.keys().next().value;
      if (oldest !== undefined) this.sessions.delete(oldest);
    }
    const created: SessionEntry = { projection: createSessionProjection({ sessionKey }), streams: new Map() };
    this.sessions.set(sessionKey, created);
    return created;
  }

  /** Reconciles a Gateway history snapshot with the session's existing projection. */
  ingestSnapshot(sessionKey: string, messages: readonly unknown[]): void {
    const entry = this.ensure(sessionKey);
    entry.projection = reduceSessionProjection(entry.projection, { type: "snapshotLoaded", messages, sessionKey });
  }

  /**
   * Feeds a Gateway `chat` run event into the projection. Returns false if the run ID is
   * missing or blank, the phase is unsupported, or the reducer rejects the event.
   * Delta text is accumulated per run; `replace: true` starts it over.
   */
  ingestRunEvent(sessionKey: string, payload: Record<string, unknown>): boolean {
    const runId = typeof payload.runId === "string" ? payload.runId.trim() : "";
    const phase = typeof payload.state === "string" ? payload.state : "";
    if (!runId || !RUN_PHASES.includes(phase)) return false;
    const entry = this.ensure(sessionKey);
    const gatewayMessage = payload.message && typeof payload.message === "object" ? payload.message : undefined;
    let message: unknown = gatewayMessage;
    if (phase === "delta") {
      const previous = payload.replace === true ? "" : entry.streams.get(runId) ?? "";
      const content = gatewayMessage ? messageContent((gatewayMessage as Record<string, unknown>).content) : previous + (typeof payload.deltaText === "string" ? payload.deltaText : "");
      entry.streams.set(runId, content);
      message = { role: "assistant", content, timestamp: Date.now() };
    } else {
      const streamed = entry.streams.get(runId) ?? "";
      entry.streams.delete(runId);
      if (!message) message = { role: "assistant", content: streamed, timestamp: Date.now() };
    }
    const runEvent: SessionProjectionGatewayRunEvent = {
      state: phase,
      runId,
      message,
      ...(typeof payload.yielded === "boolean" ? { yielded: payload.yielded } : {}),
      ...(typeof payload.stopReason === "string" ? { stopReason: payload.stopReason } : {}),
      ...(typeof payload.errorKind === "string" ? { errorKind: payload.errorKind } : {}),
      ...(typeof payload.errorMessage === "string" ? { errorMessage: payload.errorMessage } : {}),
    };
    const transition = reduceSessionProjectionRunEvent(entry.projection, runEvent, { sessionKey });
    if (!transition) return false;
    entry.projection = transition.projection;
    return true;
  }

  /** Shows the user's own turn immediately instead of waiting for the Gateway to persist it. */
  markSendPending(sessionKey: string, params: { message: string; idempotencyKey: string }): void {
    const entry = this.ensure(sessionKey);
    entry.projection = reduceSessionProjection(entry.projection, {
      type: "sendPending",
      sessionKey,
      idempotencyKey: params.idempotencyKey,
      message: {
        role: "user",
        content: params.message,
        timestamp: Date.now(),
        __openclaw: { idempotencyKey: params.idempotencyKey },
      },
    });
  }

  /** Marks an optimistic send as failed using its idempotency key; unknown sessions are ignored. */
  failSend(sessionKey: string, idempotencyKey: string): void {
    const entry = this.sessions.get(sessionKey);
    if (!entry) return;
    entry.projection = reduceSessionProjection(entry.projection, { type: "sendFailed", sessionKey, runId: idempotencyKey });
  }

  reset(sessionKey: string): void {
    this.sessions.delete(sessionKey);
  }

  /**
   * Returns displayable user and assistant messages, including eligible run overlays.
   * `streaming` is true when a displayed run is streaming. Unknown sessions return an empty view.
   */
  serialize(sessionKey: string): SerializedProjection {
    const entry = this.sessions.get(sessionKey);
    if (!entry) return { messages: [], streaming: false };
    const { projection } = entry;
    const messages: ProjectionMessage[] = [];
    projection.entries.forEach((item, index) => {
      const message = toMessage(item.message, index);
      if (!message) return;
      messages.push(item.pending ? { ...message, pending: true } : message);
    });
    const persistedRunIds = new Set(
      projection.entries
        .map((item) => item.identity?.runId)
        .filter((runId): runId is string => typeof runId === "string" && runId.length > 0),
    );
    let streaming = false;
    for (const [runId, run] of Object.entries(projection.runs)) {
      if (!run.message || persistedRunIds.has(runId)) continue;
      if (run.status !== "streaming" && projection.entries.some((item) => hasSessionProjectionAcceptedFinal(run, item.message))) continue;
      const message = toMessage(run.message, messages.length);
      if (!message) continue;
      if (run.status === "streaming") streaming = true;
      messages.push({
        ...message,
        id: message.id || `run:${runId}`,
        ...(run.status === "streaming" ? { pending: true } : {}),
      });
    }
    return { messages, streaming };
  }
}
