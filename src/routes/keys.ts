import { Hono } from "hono";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "../db/client.js";
import type { ApiKeyTier } from "../types/index.js";

const router = new Hono();

const TIER_LIMITS: Record<ApiKeyTier, number> = {
  free: 50,
  pro: 1000,
  business: 5000,
  enterprise: 50000,
};

const REG_RATE_LIMIT = 10;
const REG_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkRegistrationRateLimit(ip: string): boolean {
  const db = getDb();
  const windowStart = Math.floor(Date.now() / REG_WINDOW_MS) * REG_WINDOW_MS;
  const key = `reg:${ip}`;

  const row = db
    .prepare("SELECT count FROM rate_limits WHERE rl_key = ? AND window_start = ?")
    .get(key, windowStart) as { count: number } | undefined;

  const currentCount = row?.count ?? 0;
  if (currentCount >= REG_RATE_LIMIT) return false;

  if (row) {
    db.prepare(
      "UPDATE rate_limits SET count = count + 1 WHERE rl_key = ? AND window_start = ?",
    ).run(key, windowStart);
  } else {
    try {
      db.prepare(
        "INSERT INTO rate_limits (rl_key, window_start, count) VALUES (?, ?, 1)",
      ).run(key, windowStart);
    } catch {
      db.prepare(
        "UPDATE rate_limits SET count = count + 1 WHERE rl_key = ? AND window_start = ?",
      ).run(key, windowStart);
    }
  }
  return true;
}

// Self-service registration creates free keys only.
// Pro / Business / Enterprise upgrades require Stripe checkout — POST /v1/checkout.
const RegisterSchema = z.object({
  email: z.string().email().max(200),
});

router.post("/", async (c) => {
  // IP-based rate limiting: 10 registrations per IP per hour
  // TRUSTED_PROXIES controls how many proxy hops to skip from the right of X-Forwarded-For.
  // Default=0 takes the rightmost IP (safest against client spoofing).
  const trustedProxies = parseInt(process.env.TRUSTED_PROXIES ?? "0", 10);
  const xff = c.req.header("X-Forwarded-For");
  const ip = xff
    ? (xff.split(",").map((s) => s.trim())[Math.max(0, xff.split(",").length - 1 - trustedProxies)] ?? "127.0.0.1")
    : (c.req.header("CF-Connecting-IP") ?? "127.0.0.1");

  if (!checkRegistrationRateLimit(ip)) {
    return c.json(
      {
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many registration attempts from this IP. Try again in an hour.",
        },
      },
      429,
      { "Retry-After": "3600" },
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid JSON body" } }, 400);
  }

  const parsed = RegisterSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request",
          details: parsed.error.issues,
        },
      },
      422,
    );
  }

  const tier = "free" as const;
  const rawKey = randomBytes(32).toString("hex");
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const webhookSecret = randomBytes(24).toString("hex");
  const keyId = randomUUID();
  const now = new Date();
  const nextMidnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );

  const db = getDb();
  db.prepare(
    `INSERT INTO api_keys (key_id, key_hash, tier, daily_limit, daily_used, reset_at, webhook_secret, billing_cycle, created_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, 'monthly', ?)`,
  ).run(keyId, keyHash, tier, TIER_LIMITS[tier], nextMidnight.toISOString(), webhookSecret, now.toISOString());

  return c.json(
    {
      api_key: rawKey,
      key_id: keyId,
      tier,
      daily_limit: TIER_LIMITS[tier],
      webhook_secret: webhookSecret,
      message: "Store this API key securely — it will not be shown again.",
    },
    201,
  );
});

export default router;
