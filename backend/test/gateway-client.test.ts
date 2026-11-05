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
  client.onEvent((event) => { if (event.event === "projection") projections.push(event.payload); });
  // Exercise the real event callback exposed to the fake Gateway.
  const fakeEvent = { event: "chat", payload: { sessionKey: key, runId: "run-mock", state: "delta", deltaText: "实时" } } as Parameters<NonNullable<ConstructorParameters<typeof GatewayClient>[0]["onEvent"]>>[0];
  instances[0]?.emit(fakeEvent);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.ok(projections.some((item) => JSON.stringify(item).includes("实时")));

  let restored = false;
  client.onEvent((event) => { if (event.event === "connection.restored") restored = true; });
  instances[0]?.close();
  assert.equal(client.getStatus().state, "disconnected");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(instances.length, 1);
  assert.equal(client.getStatus().state, "connected");
  assert.equal(restored, true);
});
