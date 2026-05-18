import { Hono } from "hono";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/client.js";
import { validate } from "../services/tax-id.js";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rate-limit.js";
import type { ApiKey, TaxIdType } from "../types/index.js";

const router = new Hono();

const ValidateSchema = z.object({
  id: z.string().min(1).max(200),
  country: z.string().length(2),
  type: z.enum(["EIN", "VAT", "GST", "ABN", "GSTIN"]),
});

router.post("/", authMiddleware, rateLimitMiddleware, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid JSON body" } }, 400);
  }

  const parsed = ValidateSchema.safeParse(body);
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

  const { id, country, type } = parsed.data;
  const apiKey = c.get("apiKey") as ApiKey;

  const result = validate(id, country, type as TaxIdType);
  const jobId = uuidv4();
  const checkedAt = new Date().toISOString();

  const db = getDb();
  db.prepare(
    `INSERT INTO validation_jobs (job_id, status, valid, tax_id, country, type, format_normalized, fraud_risk_score, error, checked_at, api_key_id)
     VALUES (?, 'complete', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    jobId,
    result.valid ? 1 : 0,
    id,
    country.toUpperCase(),
    type,
    result.normalized,
    result.fraud_risk_score,
    result.error ?? null,
    checkedAt,
    apiKey.key_id,
  );

  return c.json({
    valid: result.valid,
    id,
    country: country.toUpperCase(),
    type,
    format_normalized: result.normalized,
    fraud_risk_score: result.fraud_risk_score,
    checked_at: checkedAt,
    ...(result.error ? { error: result.error } : {}),
  });
});

export default router;
