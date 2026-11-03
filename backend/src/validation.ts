const MAX_MESSAGE_LENGTH = 20_000;
const MAX_HISTORY_LIMIT = 200;

export type Parsed<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

export interface HistoryQuery { sessionKey: string; limit: number }
export interface MessagePayload { sessionKey: string; message: string; idempotencyKey: string }

export function parseHistoryQuery(query: Record<string, unknown>): Parsed<HistoryQuery> {
  const sessionKey = typeof query.sessionKey === "string" ? query.sessionKey.trim() : "";
  if (!sessionKey) return { ok: false, status: 400, error: "sessionKey is required" };
  const requestedLimit = Number(query.limit ?? 80);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_HISTORY_LIMIT) {
    return { ok: false, status: 400, error: `limit must be between 1 and ${MAX_HISTORY_LIMIT}` };
  }
  return { ok: true, value: { sessionKey, limit: requestedLimit } };
}

export function parseSessionKey(query: Record<string, unknown>): Parsed<string> {
  const sessionKey = typeof query.sessionKey === "string" ? query.sessionKey.trim() : "";
  if (!sessionKey) return { ok: false, status: 400, error: "sessionKey is required" };
  return { ok: true, value: sessionKey };
}

export function parseMessageBody(body: unknown): Parsed<MessagePayload> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Request body must be a JSON object" };
  }
  const { message, sessionKey, idempotencyKey } = body as Record<string, unknown>;
  if (typeof message !== "string" || !message.trim()) {
    return { ok: false, status: 400, error: "message must be a non-empty string" };
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, status: 413, error: `message must be at most ${MAX_MESSAGE_LENGTH} characters` };
  }
  if (typeof sessionKey !== "string" || !sessionKey.trim()) {
    return { ok: false, status: 400, error: "sessionKey must be a non-empty string" };
  }
  if (typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
    return { ok: false, status: 400, error: "idempotencyKey must be a non-empty string" };
  }
  return {
    ok: true,
    value: { sessionKey: sessionKey.trim(), message: message.trim(), idempotencyKey: idempotencyKey.trim() },
  };
}
