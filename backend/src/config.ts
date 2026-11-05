import "dotenv/config";

function positivePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

function optionalUrl(value: string | undefined, name: string): string | undefined {
  const input = value?.trim();
  if (!input) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(parsed.protocol)) {
    throw new Error(`${name} must use http, https, ws, or wss`);
  }
  return input;
}

function requiredSecret(value: string | undefined, name: string, minLength: number): string {
  const input = value?.trim() ?? "";
  if (input.length < minLength) throw new Error(`${name} must be set and at least ${minLength} characters long`);
  return input;
}

function optionalPublicOrigin(value: string | undefined): string | undefined {
  const input = value?.trim();
  if (!input) return undefined;
  let parsed: URL;
  try { parsed = new URL(input); }
  catch { throw new Error("WEBUI_PUBLIC_ORIGIN must be a valid origin URL"); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== input.replace(/\/$/, "") || parsed.username || parsed.password) {
    throw new Error("WEBUI_PUBLIC_ORIGIN must contain only an http(s) scheme, host, and optional port");
  }
  return parsed.origin;
}

export const config = {
  port: positivePort(process.env.PORT, 3001),
  webui: {
    password: requiredSecret(process.env.WEBUI_PASSWORD, "WEBUI_PASSWORD", 12),
    sessionSecret: requiredSecret(process.env.WEBUI_SESSION_SECRET, "WEBUI_SESSION_SECRET", 32),
    secureCookies: process.env.WEBUI_SECURE_COOKIE === "true",
    publicOrigin: optionalPublicOrigin(process.env.WEBUI_PUBLIC_ORIGIN),
  },
  openclaw: {
    url: optionalUrl(process.env.OPENCLAW_URL, "OPENCLAW_URL"),
    token: process.env.OPENCLAW_TOKEN?.trim() || undefined,
    password: process.env.OPENCLAW_PASSWORD?.trim() || undefined,
    statePath: process.env.OPENCLAW_STATE_PATH?.trim() || undefined,
  },
};
