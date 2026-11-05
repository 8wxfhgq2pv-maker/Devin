import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionProjectionStore } from "../src/openclaw/projection.js";

const KEY = "agent:main:chat:1";

test("snapshot renders the durable transcript in order", () => {
  const store = new SessionProjectionStore();
  store.ingestSnapshot(KEY, [
    { role: "user", content: "你好", timestamp: 1000, id: "m1" },
    { role: "assistant", content: "你好！", timestamp: 2000, id: "m2" },
  ]);
  const projection = store.serialize(KEY);
  assert.equal(projection.streaming, false);
  assert.deepEqual(projection.messages.map((row) => [row.role, row.content]), [["user", "你好"], ["assistant", "你好！"]]);
});

test("streamed deltas accumulate into a single pending assistant message", () => {
  const store = new SessionProjectionStore();
  store.ingestSnapshot(KEY, [{ role: "user", content: "写点东西", id: "m1" }]);

  assert.equal(store.ingestRunEvent(KEY, { runId: "r1", state: "delta", deltaText: "第一" }), true);
  store.ingestRunEvent(KEY, { runId: "r1", state: "delta", deltaText: "部分" });

  const mid = store.serialize(KEY);
  assert.equal(mid.streaming, true);
  const live = mid.messages.at(-1);
  assert.equal(live?.role, "assistant");
  assert.equal(live?.content, "第一部分");
  assert.equal(live?.pending, true);
  assert.equal(mid.messages.filter((row) => row.role === "assistant").length, 1);
});

test("a final event replaces the streamed text and clears the streaming flag", () => {
  const store = new SessionProjectionStore();
  store.ingestSnapshot(KEY, [{ role: "user", content: "问", id: "m1" }]);
  store.ingestRunEvent(KEY, { runId: "r1", state: "delta", deltaText: "草稿" });
  store.ingestRunEvent(KEY, { runId: "r1", state: "final", message: { role: "assistant", content: "正式回复", id: "a1" } });

  const done = store.serialize(KEY);
  assert.equal(done.streaming, false);
  const assistant = done.messages.filter((row) => row.role === "assistant");
  assert.equal(assistant.length, 1);
  assert.equal(assistant[0]?.content, "正式回复");
  assert.equal(assistant[0]?.pending, undefined);
});

test("a later snapshot does not duplicate the final message", () => {
  const store = new SessionProjectionStore();
  store.ingestSnapshot(KEY, [{ role: "user", content: "问", id: "m1" }]);
  store.ingestRunEvent(KEY, { runId: "r1", state: "delta", deltaText: "正式回复" });
  store.ingestRunEvent(KEY, { runId: "r1", state: "final", message: { role: "assistant", content: "正式回复", id: "a1" } });

  store.ingestSnapshot(KEY, [
    { role: "user", content: "问", timestamp: 1000, id: "m1" },
    { role: "assistant", content: "正式回复", timestamp: 2000, id: "a1" },
  ]);

  const reconciled = store.serialize(KEY);
  assert.deepEqual(reconciled.messages.map((row) => row.content), ["问", "正式回复"]);
});

test("replayed final run events do not duplicate assistant messages", () => {
  const store = new SessionProjectionStore();
  store.ingestSnapshot(KEY, [{ role: "user", content: "问", id: "m1" }]);
  const finalEvent = { runId: "run-replay", state: "final", message: { role: "assistant", content: "唯一回复", id: "assistant-1" } };
  assert.equal(store.ingestRunEvent(KEY, finalEvent), true);
  assert.equal(store.ingestRunEvent(KEY, finalEvent), true);
  const assistantMessages = store.serialize(KEY).messages.filter((message) => message.role === "assistant");
  assert.equal(assistantMessages.length, 1);
  assert.equal(assistantMessages[0]?.content, "唯一回复");
});

test("the optimistic user turn is replaced by the durable row, not duplicated", () => {
  const store = new SessionProjectionStore();
  store.ingestSnapshot(KEY, [{ role: "user", content: "第一句", id: "m1" }]);
  store.markSendPending(KEY, { message: "第二句", idempotencyKey: "k1" });

  const optimistic = store.serialize(KEY);
  assert.equal(optimistic.messages.length, 2);
  assert.equal(optimistic.messages.at(-1)?.pending, true);

  store.ingestSnapshot(KEY, [
    { role: "user", content: "第一句", id: "m1" },
    { role: "user", content: "第二句", id: "m2", __openclaw: { idempotencyKey: "k1" } },
  ]);

  // The projection decides whether an unanswered turn is still pending; what matters here is
  // that the durable row replaced the optimistic one instead of being appended next to it.
  const settled = store.serialize(KEY);
  assert.equal(settled.messages.length, 2);
  assert.equal(settled.messages.at(-1)?.id, "m2");
  assert.equal(settled.messages.at(-1)?.content, "第二句");
});

test("a failed send removes the optimistic turn", () => {
  const store = new SessionProjectionStore();
  store.markSendPending(KEY, { message: "发不出去", idempotencyKey: "k9" });
  assert.equal(store.serialize(KEY).messages.length, 1);
  store.failSend(KEY, "k9");
  assert.equal(store.serialize(KEY).messages.length, 0);
});

test("aborted runs stop the streaming overlay", () => {
  const store = new SessionProjectionStore();
  store.ingestSnapshot(KEY, [{ role: "user", content: "问", id: "m1" }]);
  store.ingestRunEvent(KEY, { runId: "r2", state: "delta", deltaText: "写到一半" });
  store.ingestRunEvent(KEY, { runId: "r2", state: "aborted" });
  const after = store.serialize(KEY);
  assert.equal(after.streaming, false);
  assert.equal(after.messages.at(-1)?.pending, undefined);
});

test("non-run payloads are ignored", () => {
  const store = new SessionProjectionStore();
  assert.equal(store.ingestRunEvent(KEY, { runId: "r1", state: "created" }), false);
  assert.equal(store.ingestRunEvent(KEY, { state: "delta", deltaText: "no run id" }), false);
  assert.deepEqual(store.serialize(KEY), { messages: [], streaming: false });
});
