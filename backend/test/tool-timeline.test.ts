import assert from "node:assert/strict";
import { test } from "node:test";
import { reduceToolActivity } from "../src/openclaw/tool-timeline.js";

test("tool start and result events merge into one completed timeline item", () => {
  const started = reduceToolActivity([], {
    runId: "run-1", seq: 1, stream: "tool",
    data: { phase: "start", toolCallId: "call-1", name: "read_file", args: { path: "README.md" } },
  }, 100);
  assert.equal(started.length, 1);
  assert.equal(started[0]?.status, "running");
  const completed = reduceToolActivity(started, {
    runId: "run-1", seq: 2, stream: "tool",
    data: { phase: "result", toolCallId: "call-1", name: "read_file", result: "# Project" },
  }, 200);
  assert.equal(completed.length, 1);
  assert.equal(completed[0]?.status, "completed");
  assert.equal(completed[0]?.startedAt, 100);
  assert.equal(completed[0]?.updatedAt, 200);
  assert.match(completed[0]?.input ?? "", /README\.md/);
  assert.equal(completed[0]?.output, "# Project");
});

test("tool errors are represented and unrelated events are ignored", () => {
  const ignored = reduceToolActivity([], { runId: "run-1", stream: "assistant", data: { phase: "start" } });
  assert.deepEqual(ignored, []);
  const failed = reduceToolActivity([], {
    runId: "run-2", stream: "tool", data: { phase: "error", callId: "call-2", toolName: "exec", error: "permission denied" },
  }, 300);
  assert.equal(failed[0]?.status, "error");
  assert.equal(failed[0]?.output, "permission denied");
});

test("timeline caps retained events and detail size", () => {
  let items = [] as ReturnType<typeof reduceToolActivity>;
  for (let index = 0; index < 55; index++) {
    items = reduceToolActivity(items, { runId: "run", seq: index, stream: "tool", data: { phase: "start", id: `call-${index}`, name: "tool", args: "x".repeat(13_000) } }, index);
  }
  assert.equal(items.length, 50);
  assert.equal(items[0]?.id, "call-5");
  assert.equal(items[0]?.input?.length, 12_000);
});


test("only exact terminal phases complete a tool activity", () => {
  for (const phase of ["start", "update", "partial_result", "pending", "incomplete", "error_pending"]) {
    const items = reduceToolActivity([], { stream: "tool", data: { id: "call", phase } }, 100);
    assert.equal(items[0]?.status, "running", phase);
  }
  const failed = reduceToolActivity([], {
    stream: "tool", data: { id: "call", phase: "result", isError: true, result: "failed" },
  }, 100);
  assert.equal(failed[0]?.status, "error");
});

test("late running events preserve terminal status and still merge details", () => {
  for (const phase of ["result", "error"]) {
    const terminal = reduceToolActivity([], { stream: "tool", data: { id: "call", phase } }, 100);
    for (const latePhase of ["start", "update", "partial_result", "pending"]) {
      const updated = reduceToolActivity(terminal, {
        stream: "tool", data: { id: "call", phase: latePhase, output: "late detail" },
      }, 200);
      assert.equal(updated.length, 1);
      assert.equal(updated[0]?.status, terminal[0]?.status);
      assert.equal(updated[0]?.startedAt, 100);
      assert.equal(updated[0]?.updatedAt, 200);
      assert.equal(updated[0]?.output, "late detail");
    }
  }
});
