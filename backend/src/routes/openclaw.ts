import { Router, type Request } from "express";
import type { GatewayOpenClawClient, OpenClawEvent } from "../openclaw/client.js";
import { parseHistoryQuery, parseMessageBody, parseSessionKey } from "../validation.js";

export function openclawRouter(client: GatewayOpenClawClient, isAuthenticated: (req: Request) => boolean): Router {
  const router = Router();

  router.get("/status", (_req, res) => res.json(client.getStatus()));

  router.post("/connect", async (_req, res, next) => {
    try { await client.connect(); res.json(client.getStatus()); }
    catch (err) { next(err); }
  });

  router.get("/sessions", async (_req, res, next) => {
    try { res.json({ sessions: await client.listSessions() }); }
    catch (err) { next(err); }
  });

  router.post("/sessions", async (_req, res, next) => {
    try { res.status(201).json(await client.createSession()); }
    catch (err) { next(err); }
  });

  router.get("/history", async (req, res, next) => {
    const parsed = parseHistoryQuery(req.query);
    if (!parsed.ok) { res.status(parsed.status).json({ error: parsed.error }); return; }
    try { res.json({ messages: await client.getHistory(parsed.value.sessionKey, parsed.value.limit) }); }
    catch (err) { next(err); }
  });

  router.post("/abort", async (req, res, next) => {
    const parsed = parseSessionKey((req.body ?? {}) as Record<string, unknown>);
    if (!parsed.ok) { res.status(parsed.status).json({ error: parsed.error }); return; }
    try { res.status(202).json(await client.abortRun({ sessionKey: parsed.value })); }
    catch (err) { next(err); }
  });

  router.get("/events", (req, res) => {
    const parsed = parseSessionKey(req.query);
    if (!parsed.ok) { res.status(parsed.status).json({ error: parsed.error }); return; }
    const sessionKey = parsed.value;
    res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
    res.flushHeaders();
    res.write(`event: ready\ndata: ${JSON.stringify({ connected: client.getStatus().state === "connected" })}\n\n`);
    res.write(`event: projection\ndata: ${JSON.stringify({ sessionKey, ...client.getProjection(sessionKey) })}\n\n`);
    res.write(`event: tool.timeline\ndata: ${JSON.stringify({ sessionKey, items: client.getToolTimeline(sessionKey) })}\n\n`);
    let closed = false;
    const send = (event: OpenClawEvent) => {
      if (closed) return;
      if (!isAuthenticated(req)) { res.end(); cleanup(); return; }
      if (event.event === "projection") {
        if (!eventBelongsToSession(event.payload, sessionKey)) return;
        res.write(`event: projection\ndata: ${JSON.stringify(event.payload)}\n\n`);
        return;
      }
      if (event.event === "tool.timeline") {
        if (!eventBelongsToSession(event.payload, sessionKey)) return;
        res.write(`event: tool.timeline\ndata: ${JSON.stringify(event.payload)}\n\n`);
        return;
      }
      if (event.event.startsWith("connection.")) {
        res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.payload)}\n\n`);
      }
    };
    const unsubscribe = client.onEvent(send);
    const heartbeat = setInterval(() => { if (!isAuthenticated(req)) { res.end(); cleanup(); return; } if (!closed) res.write(": keepalive\n\n"); }, 20_000);
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.on("close", cleanup);
    res.on("close", cleanup);
    res.on("error", cleanup);
  });

  router.post("/messages", async (req, res, next) => {
    const parsed = parseMessageBody(req.body);
    if (!parsed.ok) { res.status(parsed.status).json({ error: parsed.error }); return; }
    try { res.status(202).json(await client.sendMessage(parsed.value)); }
    catch (err) { next(err); }
  });

  return router;
}

export function eventBelongsToSession(payload: unknown, sessionKey: string): boolean {
  if (!payload || typeof payload !== "object") return false;
  const row = payload as Record<string, unknown>;
  return row.sessionKey === sessionKey || row.session === sessionKey;
}
