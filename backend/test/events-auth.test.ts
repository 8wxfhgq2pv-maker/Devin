import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { test } from "node:test";
import { createSecurity } from "../src/security.js";
import { openclawRouter } from "../src/routes/openclaw.js";
import type { GatewayOpenClawClient, OpenClawEventListener } from "../src/openclaw/client.js";

for (const invalidate of ["logout", "expiry"]) {
  test(`SSE stops sending private events after session ${invalidate}`, async (t) => {
    const security = createSecurity({ password: "test-password", secret: "s".repeat(32) });
    let listener: OpenClawEventListener | undefined;
    let unsubscribed = false;
    const client = {
      getStatus: () => ({ state: "connected" }),
      getProjection: () => ({ messages: [] }),
      getToolTimeline: () => [],
      getAgentRunTimeline: () => [],
      onEvent: (callback: OpenClawEventListener) => { listener = callback; return () => { unsubscribed = true; }; },
    } as unknown as GatewayOpenClawClient;
    const app = express();
    app.use(express.json());
    app.use("/api/auth", security.authRoutes);
    app.use("/api/openclaw", security.requireAuth, openclawRouter(client, security.isAuthenticated));
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => { server.closeAllConnections(); server.close(); });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "test-password" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const response = await fetch(`${base}/api/openclaw/events?sessionKey=test`, { headers: { cookie }, signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    await reader.read();
    listener!({ event: "connection.restored", payload: { message: "allowed" } });
    assert.match(new TextDecoder().decode((await reader.read()).value), /allowed/);
    listener!({ event: "agent.run.timeline", payload: { sessionKey: "test", items: [{ runId: "run-1", status: "running" }] } });
    assert.match(new TextDecoder().decode((await reader.read()).value), /run-1/);
    if (invalidate === "logout") {
      await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { cookie } });
    } else {
      t.mock.method(Date, "now", () => Number(cookie.split("=")[1]!.split(":")[0]) * 1000);
    }
    listener!({ event: "projection", payload: { sessionKey: "test", messages: ["private"] } });
    assert.equal((await reader.read()).done, true);
    assert.equal(unsubscribed, true);
  });
}
