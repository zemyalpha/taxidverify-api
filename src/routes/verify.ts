import { Hono } from "hono";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { getDb } from "../db/client.js";
import { validate, adjustScoreForRegistry } from "../services/tax-id.js";
import { lookupRegistry, VIES_COUNTRIES } from "../services/registry.js";
import { registryQueue } from "../services/queue.js";
import { deliverWebhook } from "../services/webhook.js";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rate-limit.js";
import { validateWebhookUrl, SSRFError } from "../utils/ssrf.js";
import type { ApiKey, TaxIdType } from "../types/index.js";

const router = new Hono();

const VerifySchema = z.object({
  id: z.string().min(1).max(200),
  country: z.string().length(2),
  type: z.enum(["EIN", "VAT", "GST", "ABN", "GSTIN"]),
  webhook_url: z.string().url().max(200).optional(),
});

router.post("/", authMiddleware, rateLimitMiddleware, async (c) => {
  const apiKey = c.get("apiKey") as ApiKey;

  if (apiKey.tier === "free") {
    return c.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Registry verification requires Pro tier or above",
          upgrade_url: "/v1/checkout",
        },
      },
      403,
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid JSON body" } }, 400);
  }

  const parsed = VerifySchema.safeParse(body);
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

  const { id, country, type, webhook_url } = parsed.data;

  if (webhook_url) {
    try {
      await validateWebhookUrl(webhook_url);
    } catch (err) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: err instanceof SSRFError ? err.message : "Invalid webhook URL",
          },
        },
        422,
      );
    }
  }

  const result = validate(id, country, type as TaxIdType);
  const jobId = randomUUID();
  const checkedAt = new Date().toISOString();

  const db = getDb();
  db.prepare(
    `INSERT INTO validation_jobs (job_id, status, valid, tax_id, country, type, format_normalized, fraud_risk_score, error, webhook_url, webhook_secret, checked_at, api_key_id)
     VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    jobId,
    result.valid ? 1 : 0,
    id,
    country.toUpperCase(),
    type,
    result.normalized,
    result.fraud_risk_score,
    result.error ?? null,
    webhook_url ?? null,
    apiKey.webhook_secret ?? null,
    checkedAt,
    apiKey.key_id,
  );

  // Higher-tier keys get priority processing: enterprise=2, business=1, pro=0
  const queuePriority = apiKey.tier === "enterprise" ? 2 : apiKey.tier === "business" ? 1 : 0;

  // Kick off async registry lookup
  void registryQueue.add(async () => {
    db.prepare("UPDATE validation_jobs SET status = 'processing' WHERE job_id = ?").run(jobId);
    try {
      const reg = await lookupRegistry(id, country.toUpperCase(), type as TaxIdType);
      const adjustedScore = adjustScoreForRegistry(
        result.fraud_risk_score,
        reg.registered,
        reg.registration_date ?? null,
      );
      db.prepare(
        `UPDATE validation_jobs SET status = 'complete', registered = ?, business_name = ?, registered_address = ?, registration_date = ?, fraud_risk_score = ? WHERE job_id = ?`,
      ).run(
        reg.registered ? 1 : 0,
        reg.business_name ?? null,
        reg.registered_address ?? null,
        reg.registration_date ?? null,
        adjustedScore,
        jobId,
      );

      if (webhook_url) {
        const jobRow = db.prepare("SELECT * FROM validation_jobs WHERE job_id = ?").get(jobId);
        void deliverWebhook(
          webhook_url,
          { event: "verify.complete", job: jobRow },
          apiKey.webhook_secret ?? undefined,
        );
      }
    } catch {
      db.prepare("UPDATE validation_jobs SET status = 'failed' WHERE job_id = ?").run(jobId);
    }
  }, { priority: queuePriority });

  return c.json({
    job_id: jobId,
    status: "pending",
    valid: result.valid,
    fraud_risk_score: result.fraud_risk_score,
    checked_at: checkedAt,
  });
});

router.get("/:job_id", authMiddleware, async (c) => {
  const jobId = c.req.param("job_id");
  const apiKey = c.get("apiKey") as ApiKey;
  const db = getDb();

  const job = db
    .prepare("SELECT * FROM validation_jobs WHERE job_id = ? AND api_key_id = ?")
    .get(jobId, apiKey.key_id) as Record<string, unknown> | undefined;

  if (!job) {
    return c.json({ error: { code: "NOT_FOUND", message: "Job not found" } }, 404);
  }

  const isSimulated = !(job.type === "VAT" && VIES_COUNTRIES.has(job.country as string));
  return c.json({
    job_id: job.job_id,
    status: job.status,
    valid: Boolean(job.valid),
    id: job.tax_id,
    country: job.country,
    type: job.type,
    format_normalized: job.format_normalized,
    ...(job.registered !== null && job.registered !== undefined
      ? { registered: Boolean(job.registered) }
      : {}),
    ...(job.business_name ? { business_name: job.business_name } : {}),
    ...(job.registered_address ? { registered_address: job.registered_address } : {}),
    ...(job.registration_date ? { registration_date: job.registration_date } : {}),
    fraud_risk_score: job.fraud_risk_score,
    ...(job.error ? { error: job.error } : {}),
    data_source: isSimulated ? "simulated" : "live_vies",
    checked_at: job.checked_at,
  });
});

export default router;
