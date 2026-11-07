export type AgentRunStatus = "running" | "finishing" | "completed" | "error" | "aborted";

/** A bounded display summary of one Gateway Agent run. */
export interface AgentRunActivity {
  runId: string;
  status: AgentRunStatus;
  startedAt: number;
  updatedAt: number;
  failureReason?: string;
  stopReason?: string;
  timeoutPhase?: string;
}

const MAX_RUNS = 10;
const MAX_REASON_CHARS = 800;

/** Reads a non-empty string from the Gateway lifecycle payload. */
function stringValue(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Normalizes a lifecycle frame into the most recent bounded run summaries. */
export function reduceAgentRunActivity(
  items: readonly AgentRunActivity[],
  event: unknown,
  now = Date.now(),
): AgentRunActivity[] {
  if (!event || typeof event !== "object" || Array.isArray(event)) return [...items];
  const envelope = event as Record<string, unknown>;
  if (envelope.stream !== "lifecycle" || !envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) return [...items];
  const runId = stringValue(envelope, "runId");
  if (!runId) return [...items];
  const data = envelope.data as Record<string, unknown>;
  const phase = stringValue(data, "phase")?.toLowerCase();
  if (phase !== "start" && phase !== "finishing" && phase !== "end" && phase !== "error") return [...items];

  const stopReason = stringValue(data, "stopReason");
  const incomingStatus: AgentRunStatus = phase === "start" ? "running"
    : phase === "finishing" ? "finishing"
      : phase === "error" ? "error"
        : data.aborted === true || stopReason === "aborted" ? "aborted" : "completed";
  const index = items.findIndex((item) => item.runId === runId);
  const previous = index >= 0 ? items[index] : undefined;
  const previousTerminal = previous && (previous.status === "completed" || previous.status === "error" || previous.status === "aborted");
  const incomingNonTerminal = incomingStatus === "running" || incomingStatus === "finishing";
  const terminalPriority = (value: AgentRunStatus) => value === "error" ? 3 : value === "aborted" ? 2 : value === "completed" ? 1 : 0;
  const status = previousTerminal && incomingNonTerminal ? previous.status
    : previousTerminal && !incomingNonTerminal && terminalPriority(previous.status) > terminalPriority(incomingStatus)
      ? previous.status
      : previous?.status === "finishing" && incomingStatus === "running" ? "finishing" : incomingStatus;
  const rawReason = phase === "error" ? stringValue(data, "error") : stringValue(data, "toolErrorSummary");
  const failureReason = rawReason?.slice(0, MAX_REASON_CHARS) ?? previous?.failureReason;
  const startedAt = previous?.startedAt ?? (typeof data.startedAt === "number" && Number.isFinite(data.startedAt) ? data.startedAt : now);
  const nextItem: AgentRunActivity = {
    runId,
    status,
    startedAt,
    updatedAt: now,
    ...(failureReason ? { failureReason } : {}),
    ...(stopReason ?? previous?.stopReason ? { stopReason: stopReason ?? previous?.stopReason } : {}),
    ...(stringValue(data, "timeoutPhase") ?? previous?.timeoutPhase ? { timeoutPhase: stringValue(data, "timeoutPhase") ?? previous?.timeoutPhase } : {}),
  };
  const next = [...items];
  if (index >= 0) next[index] = nextItem;
  else next.push(nextItem);
  return next.slice(-MAX_RUNS);
}
