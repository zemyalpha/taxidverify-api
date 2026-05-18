import { createHash, randomBytes } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../src/db/client.js";
import type { ApiKeyTier } from "../src/types/index.js";

const TIER_LIMITS: Record<ApiKeyTier, number> = {
  free: 50,
  pro: 1000,
  business: 5000,
  enterprise: 50000,
};

export interface TestKey {
  rawKey: string;
  keyId: string;
  tier: ApiKeyTier;
}

/**
 * Create an API key directly in the test DB, returning the raw key.
 * Useful for tests to avoid going through the registration endpoint.
 */
export function createTestKey(tier: ApiKeyTier = "free", overrides?: {
  daily_used?: number;
  reset_at?: string;
  webhook_secret?: string | null;
}): TestKey {
  const rawKey = randomBytes(32).toString("hex");
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const keyId = uuidv4();
  const now = new Date();
  const nextMidnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );

  const db = getDb();
  db.prepare(
    `INSERT INTO api_keys (key_id, key_hash, tier, daily_limit, daily_used, reset_at, webhook_secret, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    keyId,
    keyHash,
    tier,
    TIER_LIMITS[tier],
    overrides?.daily_used ?? 0,
    overrides?.reset_at ?? nextMidnight.toISOString(),
    overrides?.webhook_secret ?? randomBytes(24).toString("hex"),
    now.toISOString(),
  );

  return { rawKey, keyId, tier };
}

export function authHeader(rawKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${rawKey}`,
    "Content-Type": "application/json",
  };
}
