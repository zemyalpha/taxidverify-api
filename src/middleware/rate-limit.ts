import { Context, Next } from "hono";
import { getDb } from "../db/client.js";
import type { ApiKey } from "../types/index.js";

function getNextResetAt(): string {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next.toISOString();
}

export async function rateLimitMiddleware(c: Context, next: Next): Promise<Response | void> {
  const apiKey = c.get("apiKey") as ApiKey;
  const db = getDb();
  const now = new Date().toISOString();

  // Reset if past reset_at
  if (now >= apiKey.reset_at) {
    const newReset = getNextResetAt();
    db.prepare("UPDATE api_keys SET daily_used = 0, reset_at = ? WHERE key_id = ?").run(
      newReset,
      apiKey.key_id,
    );
    apiKey.daily_used = 0;
    apiKey.reset_at = newReset;
  }

  // Atomic check-and-increment eliminates TOCTOU race between concurrent requests
  const row = db
    .prepare(
      "UPDATE api_keys SET daily_used = daily_used + 1 WHERE key_id = ? AND daily_used < daily_limit RETURNING daily_used",
    )
    .get(apiKey.key_id) as { daily_used: number } | undefined;

  if (!row) {
    // Paid subscribers get overage billing at $0.02/call instead of hard-blocking
    if (apiKey.stripe_subscription_id) {
      db.prepare("UPDATE api_keys SET overage_used = overage_used + 1 WHERE key_id = ?").run(
        apiKey.key_id,
      );
      c.header("X-Overage-Charge", "0.02");
      c.header(
        "X-Usage-Warning",
        "Daily limit exceeded - overage billed at $0.02/call. Upgrade at /v1/checkout",
      );
      await next();
      return;
    }

    const resetAt = new Date(apiKey.reset_at);
    const retryAfter = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
    return c.json(
      {
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: `Daily limit of ${apiKey.daily_limit} calls exceeded. Resets at ${apiKey.reset_at}.`,
          upgrade_message: `You have used ${apiKey.daily_limit}/${apiKey.daily_limit} of your daily quota. Upgrade at /v1/checkout/pro`,
          upgrade_url: "/v1/checkout",
        },
      },
      429,
      { "Retry-After": String(retryAfter) },
    );
  }

  const usagePct = row.daily_used / apiKey.daily_limit;
  if (usagePct >= 0.8) {
    c.header(
      "X-Usage-Warning",
      `${Math.round(usagePct * 100)}% of daily quota used. Consider upgrading at /v1/checkout`,
    );
  }

  await next();
}
