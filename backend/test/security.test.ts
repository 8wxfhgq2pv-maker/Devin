import assert from "node:assert/strict";
import express, { type Request, type Response } from "express";
import { once } from "node:events";
import { test } from "node:test";
import { createSecurity } from "../src/security.js";

async function fixture(publicOrigin?: string, proxySecret?: string) {
  const app = express();
  app.use(express.json());
  const security = createSecurity({ password: "correct horse battery", secret: "x".repeat(40), publicOrigin, proxySecret });
  app.use("/api", security.rateLimit);
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/auth", security.protectMutation, security.authRoutes);
  app.use("/api", security.protectMutation, security.requireAuth);
  app.get("/api/private", (_req, res) => res.json({ secret: true }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind TCP");
  return { server, base: `http://127.0.0.1:${address.port}` };
}

test("auth protects API, signs sessions, rejects cross-origin writes, and logs out", async (t) => {
  const { server, base } = await fixture();
  t.after(() => server.close());

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  const denied = await fetch(`${base}/api/private`);
  assert.equal(denied.status, 401);

  const bad = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "wrong password" }) });
  assert.equal(bad.status, 401);

  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ password: "correct horse battery" }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie");
  assert.ok(cookie?.includes("HttpOnly"));
  assert.ok(cookie?.includes("SameSite=Strict"));
  const sessionCookie = cookie?.split(";")[0];
  assert.ok(sessionCookie);

  const allowed = await fetch(`${base}/api/private`, { headers: { cookie: sessionCookie } });
  assert.equal(allowed.status, 200);
  const csrf = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { cookie: sessionCookie, origin: "https://attacker.example" } });
  assert.equal(csrf.status, 403);

  const logout = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { cookie: sessionCookie, origin: base } });
  assert.equal(logout.status, 200);
  const afterLogout = await fetch(`${base}/api/private`, { headers: { cookie: sessionCookie } });
  assert.equal(afterLogout.status, 401);
});

test("trusted public origin allows reverse-proxy Host rewriting without trusting arbitrary origins", async (t) => {
  const { server, base } = await fixture("https://console.example");
  t.after(() => server.close());
  const allowed = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://console.example" },
    body: JSON.stringify({ password: "correct horse battery" }),
  });
  assert.equal(allowed.status, 200);
  const denied = await fetch(`${base}/api/auth/logout`, {
    method: "POST",
    headers: { origin: "https://attacker.example" },
  });
  assert.equal(denied.status, 403);
});


for (const proxySecret of [undefined, "p".repeat(32)]) {
  test(`spoofed forwarded IPs cannot bypass login limits (proxy configured: ${Boolean(proxySecret)})`, async (t) => {
    const { server, base } = await fixture(undefined, proxySecret);
    t.after(() => server.close());
    for (let i = 0; i < 9; i++) {
      const result = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "x-forwarded-for": `192.0.2.${i}`, "x-webui-proxy-secret": "wrong" } });
      assert.equal(result.status, i < 8 ? 401 : 429);
    }
  });
}

test("authenticated local proxy gets independent IP buckets and rejects forwarded chains", async (t) => {
  const proxySecret = "p".repeat(32);
  const { server, base } = await fixture(undefined, proxySecret);
  t.after(() => server.close());
  for (let i = 0; i < 9; i++) {
    const result = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "x-forwarded-for": "192.0.2.1", "x-webui-proxy-secret": proxySecret } });
    assert.equal(result.status, i < 8 ? 401 : 429);
  }
  const other = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "x-forwarded-for": "192.0.2.2", "x-webui-proxy-secret": proxySecret } });
  assert.equal(other.status, 401);
  for (let i = 0; i < 9; i++) {
    const result = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "x-forwarded-for": `192.0.2.${i}, 127.0.0.1`, "x-webui-proxy-secret": proxySecret } });
    assert.equal(result.status, i < 8 ? 401 : 429);
  }
});


test("login bucket cleanup prunes expired entries and preserves active attempt counts", (t) => {
  const proxySecret = "p".repeat(32);
  const security = createSecurity({ password: "correct horse battery", secret: "x".repeat(40), proxySecret });
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);
  const deleted: unknown[] = [];
  const originalDelete = Map.prototype.delete;
  t.mock.method(Map.prototype, "delete", function (this: Map<unknown, unknown>, key: unknown) {
    deleted.push(key);
    return originalDelete.call(this, key);
  });
  const login = (ip: string) => {
    let status = 200;
    const req = {
      path: "/login", method: "POST", body: { password: "wrong" },
      socket: { remoteAddress: "127.0.0.1" },
      get: (name: string) => name === "x-forwarded-for" ? ip : name === "x-webui-proxy-secret" ? proxySecret : undefined,
    } as unknown as Request;
    const res = {
      status(code: number) { status = code; return this; },
      json() {}, setHeader() {},
    } as unknown as Response;
    security.authRoutes(req, res, () => assert.fail("login should be handled"));
    return status;
  };
  for (let i = 0; i < 5000; i++) assert.equal(login(`192.0.${Math.floor(i / 256)}.${i % 256}`), 401);
  now += 30_000;
  for (let i = 0; i < 8; i++) assert.equal(login("198.51.100.1"), 401);
  assert.equal(deleted.length, 0);
  now += 30_000; // Expiry boundary: resetAt <= now, while the active bucket has time left.
  assert.equal(login("198.51.100.2"), 401);
  assert.equal(deleted.length, 5000);
  assert.ok(deleted.includes("192.0.0.0"));
  assert.ok(!deleted.includes("198.51.100.1"));
  assert.equal(login("198.51.100.1"), 429);
  assert.equal(login("192.0.0.0"), 401);
});
