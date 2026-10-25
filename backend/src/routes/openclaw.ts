import { Router } from "express";
import type { OpenClawClient } from "../openclaw/client.js";

const MAX_MESSAGE_LENGTH = 20_000;

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

  router.post("/messages", async (req, res, next) => {
    const body: unknown = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      res.status(400).json({ error: "Request body must be a JSON object" });
      return;
    }

    const { message, sessionId } = body as Record<string, unknown>;
    if (typeof message !== "string" || !message.trim()) {
      res.status(400).json({ error: "`message` must be a non-empty string" });
      return;
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      res.status(413).json({ error: `message must be at most ${MAX_MESSAGE_LENGTH} characters` });
      return;
    }
    if (sessionId !== undefined && (typeof sessionId !== "string" || !sessionId.trim())) {
      res.status(400).json({ error: "`sessionId` must be a non-empty string when provided" });
      return;
    }

    try {
      res.json(await client.sendMessage({
        message: message.trim(),
        ...(typeof sessionId === "string" ? { sessionId: sessionId.trim() } : {}),
      }));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
