import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { test } from "node:test";
import { createSecurity } from "../src/security.js";

async function fixture(publicOrigin?: string) {
  const app = express();
  app.use(express.json());
  const security = createSecurity({ password: "correct horse battery", secret: "x".repeat(40), publicOrigin });
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
