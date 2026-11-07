import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { GatewayClient } from "@openclaw/gateway-client";
import { GatewayOpenClawClient } from "../src/openclaw/client.js";

test("Gateway mock covers connect, history, send, event projection, and reconnect", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "devin-gateway-test-"));
  const instances: Array<{ close: () => void; emit: (event: Parameters<NonNullable<ConstructorParameters<typeof GatewayClient>[0]["onEvent"]>>[0]) => void; sent: Array<{ method: string; params: unknown }> }> = [];
  const factory = ((options: ConstructorParameters<typeof GatewayClient>[0]) => {
    const sent: Array<{ method: string; params: unknown }> = [];
    const instance = {
      start() {
        const hello = { server: { version: "mock-2026.10.10" } } as Parameters<NonNullable<typeof options.onHelloOk>>[0];
        options.onHelloOk?.(hello);
      },
      stop() {},
      async stopAndWait() {},
      async request<T>(method: string, params?: unknown): Promise<T> {
        sent.push({ method, params });
        if (method === "sessions.list") return { sessions: [{ key: "agent:main:chat:1", derivedTitle: "测试会话" }] } as T;
        if (method === "chat.history") return { messages: [{ role: "user", content: "之前的问题", id: "u1" }] } as T;
        if (method === "chat.send") return { runId: "run-mock" } as T;
        if (method === "chat.abort") return { ok: true } as T;
        return {} as T;
      },
    };
    instances.push({
      sent,
      emit: (event) => options.onEvent?.(event),
      close: () => {
        options.onClose?.(1006, "mock network drop");
        // GatewayClient owns reconnection and reuses this instance/options.
        setTimeout(() => options.onHelloOk?.({ server: { version: "mock-2026.10.10" } } as Parameters<NonNullable<typeof options.onHelloOk>>[0]), 20);
      },
    });
    return instance as unknown as GatewayClient;
  }) as (options: ConstructorParameters<typeof GatewayClient>[0]) => GatewayClient;
  const client = new GatewayOpenClawClient({ url: "ws://127.0.0.1:18789", statePath: join(dir, "device.json") }, factory);
  t.after(async () => { await client.disconnect(); await rm(dir, { recursive: true, force: true }); });

  await client.connect();
  assert.equal(client.getStatus().state, "connected");
  assert.equal(client.getStatus().serverVersion, "mock-2026.10.10");
  assert.deepEqual(await client.listSessions(), [{ key: "agent:main:chat:1", title: "测试会话" }]);

  const key = "agent:main:chat:1";
  assert.equal((await client.getHistory(key))[0]?.content, "之前的问题");
  await client.sendMessage({ sessionKey: key, message: "继续", idempotencyKey: "idempotency-1" });
  assert.equal(instances[0]?.sent.some((call) => call.method === "chat.send"), true);

  const projections: unknown[] = [];
  const timelines: unknown[] = [];
  client.onEvent((event) => { if (event.event === "projection") projections.push(event.payload); });
  client.onEvent((event) => { if (event.event === "tool.timeline") timelines.push(event.payload); });
  // Exercise the real event callback exposed to the fake Gateway.
  const fakeEvent = { event: "chat", payload: { sessionKey: key, runId: "run-mock", state: "delta", deltaText: "实时" } } as Parameters<NonNullable<ConstructorParameters<typeof GatewayClient>[0]["onEvent"]>>[0];
  instances[0]?.emit(fakeEvent);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.ok(projections.some((item) => JSON.stringify(item).includes("实时")));
  instances[0]?.emit({ event: "agent", payload: { sessionKey: key, runId: "run-mock", seq: 2, stream: "tool", data: { phase: "start", toolCallId: "call-mock", name: "read_file", args: { path: "README.md" } } } } as Parameters<NonNullable<ConstructorParameters<typeof GatewayClient>[0]["onEvent"]>>[0]);
  assert.equal(client.getToolTimeline(key)[0]?.tool, "read_file");
  assert.ok(timelines.some((item) => JSON.stringify(item).includes("call-mock")));
  const runTimelines: unknown[] = [];
  client.onEvent((event) => { if (event.event === "agent.run.timeline") runTimelines.push(event.payload); });
  instances[0]?.emit({ event: "agent", payload: { sessionKey: key, runId: "run-status", stream: "lifecycle", data: { phase: "start", startedAt: 100 } } } as Parameters<NonNullable<ConstructorParameters<typeof GatewayClient>[0]["onEvent"]>>[0]);
  instances[0]?.emit({ event: "agent", payload: { sessionKey: key, runId: "run-status", stream: "lifecycle", data: { phase: "finishing" } } } as Parameters<NonNullable<ConstructorParameters<typeof GatewayClient>[0]["onEvent"]>>[0]);
  instances[0]?.emit({ event: "agent", payload: { sessionKey: key, runId: "run-status", stream: "lifecycle", data: { phase: "error", error: "Provider timed out" } } } as Parameters<NonNullable<ConstructorParameters<typeof GatewayClient>[0]["onEvent"]>>[0]);
  assert.equal(client.getAgentRunTimeline(key)[0]?.status, "error");
  assert.equal(client.getAgentRunTimeline(key)[0]?.failureReason, "Provider timed out");
  assert.ok(runTimelines.some((item) => JSON.stringify(item).includes("run-status")));

  const emitTool = (sessionKey: string, phase = "start", stream = "tool") => {
    instances[0]!.emit({ event: "agent", payload: { sessionKey, stream, data: { phase, toolCallId: "call" } } } as Parameters<NonNullable<ConstructorParameters<typeof GatewayClient>[0]["onEvent"]>>[0]);
  };
  // Fill the cache, then refresh its oldest entry while at capacity.
  for (let index = 1; index < 32; index++) emitTool(`session-${index}`);
  emitTool(key, "result");
  for (let index = 1; index < 32; index++) assert.equal(client.getToolTimeline(`session-${index}`).length, 1);
  assert.equal(client.getToolTimeline(key).length, 2);
  // An ignored event must not refresh eviction order.
  emitTool("session-1", "start", "assistant");
  emitTool("session-32");
  assert.equal(client.getToolTimeline("session-1").length, 0);
  assert.equal(client.getToolTimeline(key).length, 2);
  emitTool("session-33");
  assert.equal(client.getToolTimeline("session-2").length, 0);
  assert.equal(client.getToolTimeline("session-3").length, 1);

  let restored = false;
  client.onEvent((event) => { if (event.event === "connection.restored") restored = true; });
  instances[0]?.close();
  assert.equal(client.getStatus().state, "disconnected");
  await assert.rejects(client.connect(), /正在自动重连/);
  await assert.rejects(client.listSessions(), /正在自动重连/);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(instances.length, 1);
  assert.equal(client.getStatus().state, "connected");
  assert.equal(restored, true);
});


test("terminal reconnect pause survives the following close callback and permits manual retry", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "devin-gateway-paused-"));
  const callbacks: Array<ConstructorParameters<typeof GatewayClient>[0]> = [];
  const client = new GatewayOpenClawClient({ url: "ws://localhost:18789", statePath: join(dir, "device.json") }, (options) => {
    callbacks.push(options);
    return { start: () => options.onHelloOk?.({ server: {} } as Parameters<NonNullable<typeof options.onHelloOk>>[0]), stop() {}, async stopAndWait() {} } as unknown as GatewayClient;
  });
  t.after(async () => { await client.disconnect(); await rm(dir, { recursive: true, force: true }); });
  await client.connect();
  const events: string[] = [];
  client.onEvent((event) => events.push(event.event));
  callbacks[0]!.onReconnectPaused?.({ reason: "terminal auth failure" } as Parameters<NonNullable<(typeof callbacks)[number]["onReconnectPaused"]>>[0]);
  callbacks[0]!.onClose?.(1008, "closed");
  assert.equal(client.getStatus().state, "error");
  assert.equal(client.getStatus().message, "terminal auth failure");
  assert.deepEqual(events, ["connection.error"]);
  await client.connect();
  assert.equal(client.getStatus().state, "connected");
  assert.equal(callbacks.length, 2);
});
