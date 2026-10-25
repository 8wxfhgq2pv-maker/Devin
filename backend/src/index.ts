import express, { type ErrorRequestHandler } from "express";
import { config } from "./config.js";
import { createOpenClawClient } from "./openclaw/client.js";
import { openclawRouter } from "./routes/openclaw.js";

const app = express();
const openclaw = createOpenClawClient(config.openclaw);

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "openclaw-webui-backend" });
});

app.use("/api/openclaw", openclawRouter(openclaw));

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const message = err instanceof Error ? err.message : "OpenClaw request failed";
  console.error(message);
  res.status(502).json({ error: message });
};
app.use(errorHandler);

app.listen(config.port, "127.0.0.1", () => {
  console.log(`backend listening on http://localhost:${config.port}`);
});

process.on("SIGINT", () => { void openclaw.disconnect().finally(() => process.exit(0)); });
process.on("SIGTERM", () => { void openclaw.disconnect().finally(() => process.exit(0)); });
