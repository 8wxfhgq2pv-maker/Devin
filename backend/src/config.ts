import "dotenv/config";
import path from "node:path";

export const config = {
  port: Number(process.env.PORT) || 3001,
  openclaw: {
    url: process.env.OPENCLAW_URL?.trim() || undefined,
    token: process.env.OPENCLAW_TOKEN?.trim() || undefined,
    password: process.env.OPENCLAW_PASSWORD?.trim() || undefined,
    stateDir: path.resolve(process.env.OPENCLAW_STATE_DIR?.trim() || ".openclaw-state"),
  },
};

export type OpenClawConfig = typeof config.openclaw;
