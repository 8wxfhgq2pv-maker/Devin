import { Router } from "express";
import type { OpenClawClient, OpenClawEvent } from "../openclaw/client.js";

const SSE_HEARTBEAT_MS = 25_000;

export function openclawRouter(client: OpenClawClient): Router {
  const router = Router();

  router.get("/status", (_req, res) => {
    res.json(client.getStatus());
  });

  router.post("/connect", async (_req, res, next) => {
    try {
      await client.connect();
      res.json(client.getStatus());
    } catch (err) {
      next(err);
    }
  });

  router.post("/disconnect", async (_req, res, next) => {
    try {
      await client.disconnect();
      res.json(client.getStatus());
    } catch (err) {
      next(err);
    }
  });

  router.get("/sessions", async (_req, res, next) => {
    try {
      res.json({ sessions: await client.listSessions() });
    } catch (err) {
      next(err);
    }
  });

  router.post("/sessions", async (_req, res, next) => {
    try {
      res.status(201).json(await client.createSession());
    } catch (err) {
      next(err);
    }
  });

  router.get("/sessions/:key/messages", async (req, res, next) => {
    try {
      res.json({ messages: await client.getHistory(req.params.key) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/sessions/:key/messages", async (req, res, next) => {
    const { message } = req.body ?? {};
    if (typeof message !== "string" || !message.trim()) {
      res.status(400).json({ error: "`message` must be a non-empty string" });
      return;
    }
    try {
      res.status(202).json(await client.sendMessage({ sessionKey: req.params.key, message }));
    } catch (err) {
      next(err);
    }
  });

  router.get("/approvals", (_req, res) => {
    res.json({ approvals: client.listApprovals() });
  });

  router.post("/approvals/:id/resolve", async (req, res, next) => {
    const { decision } = req.body ?? {};
    if (typeof decision !== "string" || !decision) {
      res.status(400).json({ error: "`decision` must be a non-empty string" });
      return;
    }
    try {
      await client.resolveApproval(req.params.id, decision);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.get("/events", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (event: OpenClawEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    send({ type: "status", status: client.getStatus() });
    const unsubscribe = client.onEvent(send);
    const heartbeat = setInterval(() => res.write(": ping\n\n"), SSE_HEARTBEAT_MS);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  return router;
}
