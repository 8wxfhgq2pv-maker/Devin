import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { NextFunction, Request, Response } from "express";

const COOKIE = "devin_session";
const SESSION_SECONDS = 12 * 60 * 60;
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 120;
const MAX_LOGIN_ATTEMPTS = 8;

type Bucket = { count: number; resetAt: number };

function signature(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}
function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function cookieValue(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=");
  }
  return undefined;
}
function clientKey(req: Request, proxySecret?: string): string {
  const peer = req.socket.remoteAddress;
  const loopback = peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
  const forwarded = req.get("x-forwarded-for");
  if (loopback && proxySecret && safeEqual(req.get("x-webui-proxy-secret") ?? "", proxySecret) && forwarded && isIP(forwarded)) return forwarded;
  return peer || "unknown";
}

export interface SecurityOptions { password: string; secret: string; secureCookies?: boolean; publicOrigin?: string; proxySecret?: string }

export function createSecurity(options: SecurityOptions) {
  const requests = new Map<string, Bucket>();
  const logins = new Map<string, Bucket>();
  const sessions = new Map<string, number>();
  const isAuthenticated = (req: Request): boolean => {
    const raw = cookieValue(req);
    if (!raw) return false;
    const [payload, mac, extra] = raw.split(".");
    if (!payload || !mac || extra) return false;
    const expected = signature(payload, options.secret);
    if (!safeEqual(mac, expected)) return false;
    const [expiryText, nonce, extraPayload] = payload.split(":");
    const expiry = Number(expiryText);
    return Boolean(nonce) && !extraPayload && Number.isSafeInteger(expiry) && expiry > Math.floor(Date.now() / 1000) && sessions.get(payload) === expiry;
  };
  const cookie = (res: Response, value: string, maxAge: number) => {
    const secure = options.secureCookies ? "; Secure" : "";
    res.setHeader("Set-Cookie", `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`);
  };
  const authRoutes = (req: Request, res: Response, next: NextFunction) => {
    if (req.path === "/login" && req.method === "POST") {
      const now = Date.now();
      const key = clientKey(req, options.proxySecret);
      let bucket = logins.get(key);
      if (!bucket || bucket.resetAt <= now) { bucket = { count: 0, resetAt: now + WINDOW_MS }; logins.set(key, bucket); }
      bucket.count++;
      if (logins.size > 5000) for (const [id, item] of logins) if (item.resetAt <= now) logins.delete(id);
      if (bucket.count > MAX_LOGIN_ATTEMPTS) { res.setHeader("Retry-After", "60"); res.status(429).json({ error: "登录尝试过多，请稍后重试。" }); return; }
      const supplied = req.body && typeof req.body.password === "string" ? req.body.password : "";
      if (!safeEqual(supplied, options.password)) { res.status(401).json({ error: "密码错误。" }); return; }
      logins.delete(key);
      const expiry = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
      const payload = `${expiry}:${randomBytes(24).toString("base64url")}`;
      for (const [id, end] of sessions) if (end <= Math.floor(Date.now() / 1000)) sessions.delete(id);
      sessions.set(payload, expiry);
      cookie(res, `${payload}.${signature(payload, options.secret)}`, SESSION_SECONDS);
      res.json({ ok: true });
      return;
    }
    if (req.path === "/logout" && req.method === "POST") {
      const payload = cookieValue(req)?.split(".")[0];
      if (payload) sessions.delete(payload);
      cookie(res, "", 0);
      res.json({ ok: true });
      return;
    }
    if (req.path === "/session" && req.method === "GET") { res.json({ authenticated: isAuthenticated(req) }); return; }
    next();
  };
  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    if (!isAuthenticated(req)) { res.status(401).json({ error: "请先登录。" }); return; }
    next();
  };
  const protectMutation = (req: Request, res: Response, next: NextFunction) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) { next(); return; }
    if (req.headers["sec-fetch-site"] === "cross-site") { res.status(403).json({ error: "跨站请求已拒绝。" }); return; }
    const origin = req.get("origin");
    const host = req.get("host");
    if (origin) {
      try {
        const expectedOrigin = options.publicOrigin ? new URL(options.publicOrigin).origin : undefined;
        const actualOrigin = new URL(origin).origin;
        if (options.publicOrigin ? actualOrigin !== expectedOrigin : new URL(origin).host !== host) {
          res.status(403).json({ error: "请求来源校验失败。" }); return;
        }
      } catch { res.status(403).json({ error: "请求来源无效。" }); return; }
    }
    next();
  };
  const rateLimit = (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = clientKey(req, options.proxySecret);
    let bucket = requests.get(key);
    if (!bucket || bucket.resetAt <= now) { bucket = { count: 0, resetAt: now + WINDOW_MS }; requests.set(key, bucket); }
    bucket.count++;
    if (requests.size > 5000) for (const [id, item] of requests) if (item.resetAt <= now) requests.delete(id);
    if (bucket.count > MAX_REQUESTS) { res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)))); res.status(429).json({ error: "请求过于频繁，请稍后重试。" }); return; }
    next();
  };
  return { isAuthenticated, authRoutes, requireAuth, protectMutation, rateLimit };
}
