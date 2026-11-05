import express, { type ErrorRequestHandler } from "express";
import { config } from "./config.js";
import { statusForError } from "./http-errors.js";
import { createOpenClawClient } from "./openclaw/client.js";
import { openclawRouter } from "./routes/openclaw.js";
import { createSecurity } from "./security.js";

const app = express();
const openclaw = createOpenClawClient(config.openclaw);
const security = createSecurity({ password: config.webui.password, secret: config.webui.sessionSecret, secureCookies: config.webui.secureCookies, publicOrigin: config.webui.publicOrigin, proxySecret: config.webui.proxySecret });

app.disable("x-powered-by");
app.set("trust proxy", false);
app.use(express.json({ limit: "1mb" }));
app.use("/api", security.rateLimit);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "openclaw-webui-backend" });
});

app.use("/api/auth", security.protectMutation, security.authRoutes);
app.use("/api", security.protectMutation, security.requireAuth);
app.use("/api/openclaw", openclawRouter(openclaw, security.isAuthenticated));

const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  const message = err instanceof Error ? err.message : "OpenClaw request failed";
  const status = statusForError(err);
  console.error(message);
  if (res.headersSent) { next(err); return; }
  res.status(status).json({ error: message });
};
app.use(errorHandler);

app.listen(config.port, "127.0.0.1", () => {
  console.log(`backend listening on http://localhost:${config.port}`);
});

process.on("SIGINT", () => { void openclaw.disconnect().finally(() => process.exit(0)); });
process.on("SIGTERM", () => { void openclaw.disconnect().finally(() => process.exit(0)); });
