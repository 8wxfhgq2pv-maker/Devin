import assert from "node:assert/strict";
import { test } from "node:test";
import { reduceToolActivity } from "../src/openclaw/tool-timeline.js";

test("Gateway start, update, and result events merge into one completed timeline item", () => {
  const started = reduceToolActivity([], {
    runId: "run-1", seq: 1, stream: "tool",
    data: { phase: "start", toolCallId: "call-1", name: "read_file", args: { path: "README.md" } },
  }, 100);
  assert.equal(started.length, 1);
  assert.equal(started[0]?.status, "running");
  const updated = reduceToolActivity(started, {
    runId: "run-1", seq: 2, stream: "tool",
    data: { phase: "update", toolCallId: "call-1", name: "read_file", partialResult: "reading" },
  }, 200);
  assert.equal(updated[0]?.status, "running");
  assert.equal(updated[0]?.output, "reading");
  const completed = reduceToolActivity(updated, {
    runId: "run-1", seq: 3, stream: "tool",
    data: { phase: "result", toolCallId: "call-1", name: "read_file", isError: false, result: "# Project" },
  }, 300);
  assert.equal(completed.length, 1);
  assert.equal(completed[0]?.status, "completed");
  assert.equal(completed[0]?.startedAt, 100);
  assert.equal(completed[0]?.updatedAt, 300);
  assert.match(completed[0]?.input ?? "", /README\.md/);
  assert.equal(completed[0]?.output, "# Project");
});

test("tool errors are represented and unrelated or unknown events are ignored", () => {
  assert.deepEqual(reduceToolActivity([], { runId: "run-1", stream: "assistant", data: { phase: "start" } }), []);
  for (const phase of ["partial_result", "pending", "incomplete", "error_pending", "error"]) {
    assert.deepEqual(reduceToolActivity([], { stream: "tool", data: { phase, toolCallId: "call-invalid" } }), []);
  }
  const failed = reduceToolActivity([], {
    runId: "run-2", stream: "tool", data: { phase: "result", toolCallId: "call-2", name: "exec", isError: true, toolErrorSummary: "permission denied" },
  }, 300);
  assert.equal(failed[0]?.status, "error");
  assert.equal(failed[0]?.output, "permission denied");
});

test("input_delta stays in progress and end-compatible results become terminal", () => {
  const started = reduceToolActivity([], {
    stream: "tool", data: { phase: "input_delta", toolCallId: "call-delta", name: "edit", diff: { added: 1 } },
  }, 100);
  assert.equal(started[0]?.status, "running");
  const completed = reduceToolActivity([], {
    stream: "tool", data: { phase: "end", toolCallId: "call-end", name: "tool", isError: false, result: "ok" },
  }, 200);
  assert.equal(completed[0]?.status, "completed");
});

test("late running events preserve terminal status and still merge details", () => {
  for (const terminalPhase of ["result", "end"]) {
    for (const isError of [false, true]) {
      const terminal = reduceToolActivity([], {
        stream: "tool", data: { id: "call", phase: terminalPhase, isError },
      }, 100);
      for (const latePhase of ["start", "update", "input_delta"]) {
        const updated = reduceToolActivity(terminal, {
          stream: "tool", data: { id: "call", phase: latePhase, args: { value: "late detail" } },
        }, 200);
        assert.equal(updated.length, 1);
        assert.equal(updated[0]?.status, terminal[0]?.status);
        assert.equal(updated[0]?.startedAt, 100);
        assert.equal(updated[0]?.updatedAt, 200);
        assert.match(updated[0]?.input ?? "", /late detail/);
      }
    }
  }
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
