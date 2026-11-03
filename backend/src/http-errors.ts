import { OpenClawNotImplementedError } from "./openclaw/client.js";

/**
 * Maps an error thrown by a route handler to the HTTP status the client should see.
 * Gateway failures stay 502, while body-parser and configuration problems keep their own meaning.
 */
export function statusForError(error: unknown): number {
  if (error instanceof OpenClawNotImplementedError) return 503;
  const type = (error as { type?: unknown } | null)?.type;
  if (type === "entity.parse.failed") return 400;
  if (type === "entity.too.large") return 413;
  return 502;
}
