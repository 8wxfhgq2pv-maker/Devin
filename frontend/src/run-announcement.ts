import type { AgentRunActivity } from "./api";

const announcedStatuses = new Set<AgentRunActivity["status"]>(["finishing", "completed", "error", "aborted"]);
const statusLabels: Record<AgentRunActivity["status"], string> = {
  running: "运行中",
  finishing: "正在收尾",
  completed: "已完成",
  error: "运行失败",
  aborted: "已中止",
};

/** Returns one concise announcement for the most recently changed run status. */
export function getRunStatusAnnouncement(
  previous: readonly AgentRunActivity[] | null,
  current: readonly AgentRunActivity[],
): string | null {
  if (!previous) return null;

  const previousStatuses = new Map(previous.map((run) => [run.runId, run.status]));
  const changedRuns = current.filter((run) =>
    previousStatuses.get(run.runId) !== run.status && announcedStatuses.has(run.status)
  );
  const latest = changedRuns.reduce<AgentRunActivity | undefined>(
    (selected, run) => !selected || run.updatedAt >= selected.updatedAt ? run : selected,
    undefined,
  );
  if (!latest) return null;

  return `Agent ${latest.runId.slice(-8)} ${statusLabels[latest.status]}`;
}
