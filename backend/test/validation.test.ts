import assert from "node:assert/strict";
import { test } from "node:test";
import { statusForError } from "../src/http-errors.js";
import { OpenClawNotImplementedError } from "../src/openclaw/client.js";
import { eventBelongsToSession } from "../src/routes/openclaw.js";
import { parseHistoryQuery, parseMessageBody, parseSessionKey } from "../src/validation.js";

test("parseMessageBody accepts and trims a valid payload", () => {
  const parsed = parseMessageBody({ sessionKey: " chat:1 ", message: " hi ", idempotencyKey: " k1 " });
  assert.deepEqual(parsed, { ok: true, value: { sessionKey: "chat:1", message: "hi", idempotencyKey: "k1" } });
});

test("parseMessageBody rejects non-object bodies", () => {
  for (const body of [null, undefined, "text", [], 42]) {
    const parsed = parseMessageBody(body);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.status, 400);
  }
});

test("parseMessageBody rejects blank and oversized messages", () => {
  const blank = parseMessageBody({ sessionKey: "chat:1", message: "   ", idempotencyKey: "k1" });
  assert.equal(blank.ok, false);
  if (!blank.ok) assert.equal(blank.status, 400);

  const oversized = parseMessageBody({ sessionKey: "chat:1", message: "x".repeat(20_001), idempotencyKey: "k1" });
  assert.equal(oversized.ok, false);
  if (!oversized.ok) assert.equal(oversized.status, 413);
});

test("parseMessageBody requires sessionKey and idempotencyKey", () => {
  const missingSession = parseMessageBody({ message: "hi", idempotencyKey: "k1" });
  assert.equal(missingSession.ok, false);
  if (!missingSession.ok) assert.match(missingSession.error, /sessionKey/);

  const missingKey = parseMessageBody({ message: "hi", sessionKey: "chat:1" });
  assert.equal(missingKey.ok, false);
  if (!missingKey.ok) assert.match(missingKey.error, /idempotencyKey/);
});

test("parseHistoryQuery defaults the limit and enforces its range", () => {
  assert.deepEqual(parseHistoryQuery({ sessionKey: " chat:1 " }), { ok: true, value: { sessionKey: "chat:1", limit: 80 } });
  assert.deepEqual(parseHistoryQuery({ sessionKey: "chat:1", limit: "5" }), { ok: true, value: { sessionKey: "chat:1", limit: 5 } });

  for (const limit of ["0", "201", "abc", "1.5"]) {
    const parsed = parseHistoryQuery({ sessionKey: "chat:1", limit });
    assert.equal(parsed.ok, false, `limit=${limit} should be rejected`);
    if (!parsed.ok) assert.equal(parsed.status, 400);
  }
});

test("parseHistoryQuery and parseSessionKey require a non-empty sessionKey", () => {
  for (const query of [{}, { sessionKey: "" }, { sessionKey: "   " }, { sessionKey: ["a", "b"] }]) {
    assert.equal(parseHistoryQuery(query).ok, false);
    assert.equal(parseSessionKey(query).ok, false);
  }
  assert.deepEqual(parseSessionKey({ sessionKey: " chat:1 " }), { ok: true, value: "chat:1" });
});

test("eventBelongsToSession only matches the requested session", () => {
  assert.equal(eventBelongsToSession({ sessionKey: "chat:1" }, "chat:1"), true);
  assert.equal(eventBelongsToSession({ session: "chat:1" }, "chat:1"), true);
  assert.equal(eventBelongsToSession({ sessionKey: "chat:2" }, "chat:1"), false);
  assert.equal(eventBelongsToSession(null, "chat:1"), false);
  assert.equal(eventBelongsToSession("chat:1", "chat:1"), false);
});

test("statusForError separates configuration, client and gateway failures", () => {
  assert.equal(statusForError(new OpenClawNotImplementedError("connect")), 503);
  assert.equal(statusForError(Object.assign(new Error("bad json"), { type: "entity.parse.failed" })), 400);
  assert.equal(statusForError(Object.assign(new Error("too big"), { type: "entity.too.large" })), 413);
  assert.equal(statusForError(new Error("gateway down")), 502);
  assert.equal(statusForError(undefined), 502);
});
