/** Terminal and in-flight states rendered by the Agent execution timeline. */
export type ToolActivityStatus = "running" | "completed" | "error";

/** A normalized, bounded display record for one Gateway tool call. */
export interface ToolActivity {
  id: string;
  runId: string;
  tool: string;
  status: ToolActivityStatus;
  startedAt: number;
  updatedAt: number;
  input?: string;
  output?: string;
}

const MAX_ITEMS = 50;
const MAX_DETAIL_CHARS = 12_000;

/** Convert arbitrary tool arguments/results to a bounded readable string. */
function text(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  let result: string;
  try { result = typeof value === "string" ? value : JSON.stringify(value, null, 2); }
  catch { result = String(value); }
  return result.slice(0, MAX_DETAIL_CHARS);
}
/** Return the first non-empty string value from an ordered list of possible event fields. */
function stringField(row: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) if (typeof row[key] === "string" && (row[key] as string).trim()) return (row[key] as string).trim();
  return undefined;
}

/**
 * Normalize Gateway Agent tool-stream events into an expandable timeline.
 * Only the documented `start`, `update`, and `end` phases are accepted; unknown phases are ignored.
 */
export function reduceToolActivity(items: readonly ToolActivity[], event: unknown, now = Date.now()): ToolActivity[] {
  if (!event || typeof event !== "object" || Array.isArray(event)) return [...items];
  const envelope = event as Record<string, unknown>;
  if (envelope.stream !== "tool" || !envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) return [...items];
  const data = envelope.data as Record<string, unknown>;
  const id = stringField(data, "toolCallId", "callId", "id") ?? `${stringField(envelope, "runId") ?? "run"}:${String(envelope.seq ?? now)}`;
  const runId = stringField(envelope, "runId") ?? "unknown-run";
  const tool = stringField(data, "name", "toolName", "tool") ?? "Tool";
  const phase = stringField(data, "phase")?.toLowerCase();
  if (phase !== "start" && phase !== "update" && phase !== "end") return [...items];
  const reportedError = data.isError === true
    || (typeof data.toolErrorSummary === "string" && data.toolErrorSummary.trim().length > 0)
    || (typeof data.error === "string" && data.error.trim().length > 0);
  const incomingStatus: ToolActivityStatus = phase === "end" ? (reportedError ? "error" : "completed") : "running";
  const index = items.findIndex((item) => item.id === id);
  const previous = index >= 0 ? items[index] : undefined;
  const status = previous && previous.status !== "running" && incomingStatus === "running" ? previous.status : incomingStatus;
  const input = text(data.args ?? data.arguments ?? data.input ?? data.params);
  const output = text(data.result ?? data.output ?? data.error ?? data.toolErrorSummary ?? data.partialResult ?? data.content);
  const nextItem: ToolActivity = {
    id,
    runId,
    tool: stringField(data, "name", "toolName", "tool") ?? previous?.tool ?? tool,
    status,
    startedAt: previous?.startedAt ?? now,
    updatedAt: now,
    ...(input ?? previous?.input ? { input: input ?? previous?.input } : {}),
    ...(output ?? previous?.output ? { output: output ?? previous?.output } : {}),
  };
  const next = [...items];
  if (index >= 0) next[index] = nextItem;
  else next.push(nextItem);
  return next.slice(-MAX_ITEMS);
}
