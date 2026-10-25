import { Router } from "express";
import type { OpenClawClient } from "../openclaw/client.js";

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
    const { message, sessionId } = req.body ?? {};
    if (typeof message !== "string" || !message.trim()) {
      res.status(400).json({ error: "`message` must be a non-empty string" });
      return;
    }
    try {
      res.json(await client.sendMessage({ message, sessionId }));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

