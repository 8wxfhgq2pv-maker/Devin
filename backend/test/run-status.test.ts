import assert from "node:assert/strict";
import { test } from "node:test";
import { reduceAgentRunActivity } from "../src/openclaw/run-status.js";

test("run lifecycle progresses through start, finishing, and end", () => {
  const started = reduceAgentRunActivity([], {
    runId: "run-1", stream: "lifecycle", data: { phase: "start", startedAt: 100 },
  }, 100);
  assert.equal(started[0]?.status, "running");
  const finishing = reduceAgentRunActivity(started, {
    runId: "run-1", stream: "lifecycle", data: { phase: "finishing" },
  }, 150);
  assert.equal(finishing[0]?.status, "finishing");
  const completed = reduceAgentRunActivity(finishing, {
    runId: "run-1", stream: "lifecycle", data: { phase: "end", stopReason: "stop" },
  }, 200);
  assert.equal(completed[0]?.status, "completed");
  assert.equal(completed[0]?.startedAt, 100);
  assert.equal(completed[0]?.stopReason, "stop");
});

test("successful runs do not expose tool error summaries as run failures", () => {
  const completed = reduceAgentRunActivity([], {
    runId: "run-success", stream: "lifecycle",
    data: { phase: "end", stopReason: "stop", toolErrorSummary: "A tool failed before retry succeeded" },
  }, 200);
  assert.equal(completed[0]?.status, "completed");
  assert.equal(completed[0]?.failureReason, undefined);
});

test("run errors expose bounded safe reason and cannot be downgraded by late start", () => {
  const failed = reduceAgentRunActivity([], {
    runId: "run-2", stream: "lifecycle", data: { phase: "error", error: "Provider timed out", timeoutPhase: "provider" },
  }, 300);
  assert.equal(failed[0]?.status, "error");
  assert.equal(failed[0]?.failureReason, "Provider timed out");
  assert.equal(failed[0]?.timeoutPhase, "provider");
  const replayed = reduceAgentRunActivity(failed, {
    runId: "run-2", stream: "lifecycle", data: { phase: "start", startedAt: 400 },
  }, 400);
  assert.equal(replayed[0]?.status, "error");
  assert.equal(replayed[0]?.failureReason, "Provider timed out");
  assert.equal(replayed[0]?.startedAt, 300);
  const lateSuccess = reduceAgentRunActivity(replayed, {
    runId: "run-2", stream: "lifecycle", data: { phase: "end", stopReason: "stop" },
  }, 450);
  assert.equal(lateSuccess[0]?.status, "error");
});

test("abort is distinct from success and unknown lifecycle phases are ignored", () => {
  const ignored = reduceAgentRunActivity([], { runId: "run-3", stream: "lifecycle", data: { phase: "retrying" } });
  assert.deepEqual(ignored, []);
  const aborted = reduceAgentRunActivity([], {
    runId: "run-3", stream: "lifecycle", data: { phase: "end", aborted: true, stopReason: "aborted" },
  }, 500);
  assert.equal(aborted[0]?.status, "aborted");
  assert.equal(aborted[0]?.stopReason, "aborted");
});

test("run summaries are bounded to the most recent ten runs", () => {
  let runs = [] as ReturnType<typeof reduceAgentRunActivity>;
  for (let index = 0; index < 12; index++) {
    runs = reduceAgentRunActivity(runs, { runId: `run-${index}`, stream: "lifecycle", data: { phase: "start" } }, index);
  }
  assert.equal(runs.length, 10);
  assert.equal(runs[0]?.runId, "run-2");
  assert.equal(runs.at(-1)?.runId, "run-11");
});
