import { createHash } from "node:crypto";
import { Context, Next } from "hono";
import { getDb } from "../db/client.js";
import type { ApiKey } from "../types/index.js";

export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  const authorization = c.req.header("Authorization");
  if (!authorization || !authorization.startsWith("Bearer ")) {
    return c.json(
      { error: { code: "UNAUTHORIZED", message: "Missing or invalid Authorization header" } },
      401,
    );
  }

  const rawKey = authorization.slice(7);
  if (!rawKey || rawKey.length < 32) {
    return c.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid API key format" } },
      401,
    );
  }

  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const db = getDb();
  const apiKey = db.prepare("SELECT * FROM api_keys WHERE key_hash = ?").get(keyHash) as
    | ApiKey
    | undefined;

  if (!apiKey) {
    return c.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid API key" } },
      401,
    );
  }

  c.set("apiKey", apiKey);
  c.set("rawKey", rawKey);
  await next();
}
