export type ToolActivityStatus = "running" | "completed" | "error";
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

function text(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  let result: string;
  try { result = typeof value === "string" ? value : JSON.stringify(value, null, 2); }
  catch { result = String(value); }
  return result.slice(0, MAX_DETAIL_CHARS);
}
function stringField(row: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) if (typeof row[key] === "string" && (row[key] as string).trim()) return (row[key] as string).trim();
  return undefined;
}

/** Normalize OpenClaw `agent` events with `stream: tool` into an expandable timeline item. */
export function reduceToolActivity(items: readonly ToolActivity[], event: unknown, now = Date.now()): ToolActivity[] {
  if (!event || typeof event !== "object" || Array.isArray(event)) return [...items];
  const envelope = event as Record<string, unknown>;
  if (envelope.stream !== "tool" || !envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) return [...items];
  const data = envelope.data as Record<string, unknown>;
  const id = stringField(data, "toolCallId", "callId", "id") ?? `${stringField(envelope, "runId") ?? "run"}:${String(envelope.seq ?? now)}`;
  const runId = stringField(envelope, "runId") ?? "unknown-run";
  const tool = stringField(data, "name", "toolName", "tool") ?? "Tool";
  const phase = (stringField(data, "phase", "status") ?? "").toLowerCase();
  // Gateway emits start/update/result; failed results carry isError.
  const status: ToolActivityStatus = /^(error|fail|failed|failure)$/.test(phase) || (phase === "result" && data.isError === true)
    ? "error" : /^(end|result|complete|completed|finish|finished|success)$/.test(phase) ? "completed" : "running";
  const index = items.findIndex((item) => item.id === id);
  const previous = index >= 0 ? items[index] : undefined;
  const input = text(data.args ?? data.arguments ?? data.input ?? data.params);
  const output = text(data.result ?? data.output ?? data.error ?? data.content);
  const nextItem: ToolActivity = {
    id,
    runId,
    tool: stringField(data, "name", "toolName", "tool") ?? previous?.tool ?? tool,
    status: status === "running" && previous && previous.status !== "running" ? previous.status : status,
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
