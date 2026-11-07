import assert from "node:assert/strict";
import { test } from "node:test";
import { getRunStatusAnnouncement } from "../src/run-announcement.js";
import type { AgentRunActivity } from "../src/api.js";

function run(runId: string, status: AgentRunActivity["status"], updatedAt: number): AgentRunActivity {
  return { runId, status, startedAt: 1, updatedAt };
}

test("initial timeline snapshot does not announce historical runs", () => {
  assert.equal(getRunStatusAnnouncement(null, [
    run("historical-run", "completed", 100),
    run("older-error", "error", 90),
  ]), null);
});

test("only meaningful status changes are announced", () => {
  const previous = [run("run-12345678", "running", 100)];
  assert.equal(getRunStatusAnnouncement(previous, [run("run-12345678", "running", 110)]), null);
  assert.equal(getRunStatusAnnouncement(previous, [run("run-12345678", "finishing", 120)]), "Agent 12345678 正在收尾");
  assert.equal(getRunStatusAnnouncement(previous, [run("run-12345678", "completed", 130)]), "Agent 12345678 已完成");
  assert.equal(getRunStatusAnnouncement(previous, [run("run-12345678", "error", 140)]), "Agent 12345678 运行失败");
});

test("one update announces only the most recently updated run", () => {
  const previous = [run("run-one", "running", 100), run("run-two", "running", 100)];
  const current = [run("run-one", "completed", 120), run("run-two", "error", 130)];
  assert.equal(getRunStatusAnnouncement(previous, current), "Agent run-two 运行失败");
});

test("a newly appearing run is announced only after the initial snapshot", () => {
  const previous = [run("run-existing", "running", 100)];
  assert.equal(getRunStatusAnnouncement(previous, [
    ...previous,
    run("run-new", "completed", 120),
  ]), "Agent run-new 已完成");
});
