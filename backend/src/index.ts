import express, { type ErrorRequestHandler } from "express";
import { config } from "./config.js";
import { createOpenClawClient, OpenClawNotImplementedError } from "./openclaw/client.js";
import { openclawRouter } from "./routes/openclaw.js";

const app = express();
const openclaw = createOpenClawClient(config.openclaw);

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "openclaw-webui-backend" });
});

app.use("/api/openclaw", openclawRouter(openclaw));

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof OpenClawNotImplementedError) {
    res.status(501).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
};
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`backend listening on http://localhost:${config.port}`);
});
