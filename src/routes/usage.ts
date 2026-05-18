import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { authMiddleware } from "../middleware/auth.js";
import { validateWebhookUrl, SSRFError } from "../utils/ssrf.js";
import type { ApiKey } from "../types/index.js";

const router = new Hono();

router.get("/", authMiddleware, (c) => {
  const apiKey = c.get("apiKey") as ApiKey;
  const db = getDb();

  const history = db
    .prepare(
      `SELECT date(checked_at) as date, COUNT(*) as count
       FROM validation_jobs
       WHERE api_key_id = ? AND checked_at >= datetime('now', '-30 days')
       GROUP BY date(checked_at)
       ORDER BY date DESC`,
    )
    .all(apiKey.key_id) as Array<{ date: string; count: number }>;

  const usagePct = apiKey.daily_used / apiKey.daily_limit;
  const upgradePrompt =
    usagePct >= 0.9
      ? `You've used ${Math.round(usagePct * 100)}% of your daily quota. Upgrade now to avoid service interruption: /v1/checkout`
      : usagePct >= 0.8
        ? `You've used ${Math.round(usagePct * 100)}% of your daily quota. Consider upgrading at /v1/checkout`
        : undefined;

  return c.json({
    daily_used: apiKey.daily_used,
    daily_limit: apiKey.daily_limit,
    overage_used: apiKey.overage_used ?? 0,
    reset_at: apiKey.reset_at,
    tier: apiKey.tier,
    billing_cycle: apiKey.billing_cycle ?? "monthly",
    ...(upgradePrompt ? { upgrade_prompt: upgradePrompt } : {}),
    history,
  });
});

const AlertSchema = z.object({
  threshold_percent: z.number().int().min(50).max(90),
  webhook_url: z.string().url().max(2048),
});

router.post("/alert", authMiddleware, async (c) => {
  const apiKey = c.get("apiKey") as ApiKey;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid JSON body" } }, 400);
  }

  const parsed = AlertSchema.safeParse(body);
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

  const { threshold_percent, webhook_url } = parsed.data;

  try {
    await validateWebhookUrl(webhook_url);
  } catch (err) {
    const msg = err instanceof SSRFError ? err.message : "Invalid webhook URL";
    return c.json({ error: { code: "INVALID_WEBHOOK_URL", message: msg } }, 422);
  }

  const db = getDb();
  db.prepare(
    "UPDATE api_keys SET alert_threshold = ?, alert_webhook_url = ? WHERE key_id = ?",
  ).run(threshold_percent, webhook_url, apiKey.key_id);

  return c.json({
    threshold_percent,
    webhook_url,
    message:
      "Usage alert configured. A webhook notification will fire when daily usage crosses this threshold.",
  });
});

export default router;
