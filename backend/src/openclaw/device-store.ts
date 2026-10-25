import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Ed25519 identity this backend presents to the Gateway during pairing. */
export interface DeviceIdentity {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

interface StoredTokenRecord {
  token: string;
  scopes: string[];
}

export function publicKeyRawBase64Url(publicKeyPem: string): string {
  const der = crypto.createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return der.subarray(der.length - 32).toString("base64url");
}

export function signPayload(privateKeyPem: string, payload: string): string {
  return crypto
    .sign(null, Buffer.from(payload, "utf8"), crypto.createPrivateKey(privateKeyPem))
    .toString("base64url");
}

/**
 * File-backed device identity + device-token storage. Both files are
 * credentials: they are written with mode 0600 and the directory is gitignored.
 */
export class DeviceStore {
  private readonly identityPath: string;
  private readonly tokensPath: string;

  constructor(private readonly dir: string) {
    this.identityPath = path.join(dir, "device-identity.json");
    this.tokensPath = path.join(dir, "device-tokens.json");
  }

  loadOrCreateIdentity(): DeviceIdentity {
    const existing = this.readJson<DeviceIdentity>(this.identityPath);
    if (existing?.deviceId && existing.publicKeyPem && existing.privateKeyPem) return existing;

    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const deviceId = crypto
      .createHash("sha256")
      .update(Buffer.from(publicKeyRawBase64Url(publicKeyPem), "base64url"))
      .digest("hex");
    const identity = { deviceId, publicKeyPem, privateKeyPem };
    this.writeJson(this.identityPath, identity);
    return identity;
  }

  loadToken(key: string): StoredTokenRecord | null {
    return this.readJson<Record<string, StoredTokenRecord>>(this.tokensPath)?.[key] ?? null;
  }

  storeToken(key: string, record: StoredTokenRecord, expectedToken?: string | null): void {
    const all = this.readJson<Record<string, StoredTokenRecord>>(this.tokensPath) ?? {};
    if (expectedToken === null && all[key]) return;
    if (typeof expectedToken === "string" && all[key]?.token !== expectedToken) return;
    all[key] = record;
    this.writeJson(this.tokensPath, all);
  }

  clearToken(key: string, expectedToken?: string): void {
    const all = this.readJson<Record<string, StoredTokenRecord>>(this.tokensPath);
    if (!all?.[key]) return;
    if (expectedToken !== undefined && all[key].token !== expectedToken) return;
    delete all[key];
    this.writeJson(this.tokensPath, all);
  }

  private readJson<T>(file: string): T | null {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as T;
    } catch {
      return null;
    }
  }

  private writeJson(file: string, value: unknown): void {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
}
