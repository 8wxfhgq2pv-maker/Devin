import { Router } from "express";
import type { GatewayOpenClawClient, OpenClawEvent } from "../openclaw/client.js";

const MAX_MESSAGE_LENGTH = 20_000;
const MAX_HISTORY_LIMIT = 200;

export function openclawRouter(client: GatewayOpenClawClient): Router {
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
    const sessionKey = typeof req.query.sessionKey === "string" ? req.query.sessionKey.trim() : "";
    const requestedLimit = Number(req.query.limit ?? 80);
    if (!sessionKey) { res.status(400).json({ error: "sessionKey is required" }); return; }
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_HISTORY_LIMIT) {
      res.status(400).json({ error: `limit must be between 1 and ${MAX_HISTORY_LIMIT}` }); return;
    }
    try { res.json({ messages: await client.getHistory(sessionKey, requestedLimit) }); }
    catch (err) { next(err); }
  });

  router.get("/events", (req, res) => {
    const sessionKey = typeof req.query.sessionKey === "string" ? req.query.sessionKey : "";
    res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
    res.flushHeaders();
    res.write(`event: ready\ndata: ${JSON.stringify({ connected: client.getStatus().state === "connected" })}\n\n`);
    const send = (event: OpenClawEvent) => {
      if (event.event.startsWith("connection.") || !sessionKey || eventBelongsToSession(event.payload, sessionKey)) {
        res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.payload)}\n\n`);
      }
    };
    const unsubscribe = client.onEvent(send);
    const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 20_000);
    req.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
  });

  router.post("/messages", async (req, res, next) => {
    const body: unknown = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      res.status(400).json({ error: "Request body must be a JSON object" }); return;
    }
    const { message, sessionKey, idempotencyKey } = body as Record<string, unknown>;
    if (typeof message !== "string" || !message.trim()) {
      res.status(400).json({ error: "message must be a non-empty string" }); return;
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      res.status(413).json({ error: `message must be at most ${MAX_MESSAGE_LENGTH} characters` }); return;
    }
    if (typeof sessionKey !== "string" || !sessionKey.trim()) {
      res.status(400).json({ error: "sessionKey must be a non-empty string" }); return;
    }
    if (typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
      res.status(400).json({ error: "idempotencyKey must be a non-empty string" }); return;
    }
    try {
      const result = await client.sendMessage({ sessionKey: sessionKey.trim(), message: message.trim(), idempotencyKey: idempotencyKey.trim() });
      res.status(202).json(result);
    } catch (err) { next(err); }
  });

  return router;
}

function eventBelongsToSession(payload: unknown, sessionKey: string): boolean {
  if (!payload || typeof payload !== "object") return false;
  const row = payload as Record<string, unknown>;
  return row.sessionKey === sessionKey || row.session === sessionKey;
}
