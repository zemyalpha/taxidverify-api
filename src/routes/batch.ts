import { Hono } from "hono";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
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

const BatchSchema = z.object({
  items: z
    .array(
      z.object({
        ref: z.string().min(1).max(100),
        id: z.string().min(1).max(200),
        country: z.string().length(2),
        type: z.enum(["EIN", "VAT", "GST", "ABN", "GSTIN"]),
      }),
    )
    .min(1)
    .max(100),
  webhook_url: z.string().url().max(200).optional(),
});

interface RegistryTaskParams {
  jobId: string;
  batchId: string;
  itemId: string;
  itemCountry: string;
  itemType: TaxIdType;
  baseScore: number;
  webhook_url?: string;
  webhookSecret?: string | null;
}

function processRegistryQueue(params: RegistryTaskParams): () => Promise<void> {
  return async () => {
    const db = getDb();
    db.prepare("UPDATE validation_jobs SET status = 'processing' WHERE job_id = ?").run(params.jobId);
    try {
      const reg = await lookupRegistry(params.itemId, params.itemCountry, params.itemType);
      const adjustedScore = adjustScoreForRegistry(
        params.baseScore,
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
        params.jobId,
      );
    } catch {
      db.prepare("UPDATE validation_jobs SET status = 'failed' WHERE job_id = ?").run(params.jobId);
    }

    db.prepare("UPDATE batch_jobs SET completed = completed + 1 WHERE batch_id = ?").run(params.batchId);
    const batchRow = db
      .prepare("SELECT count, completed FROM batch_jobs WHERE batch_id = ?")
      .get(params.batchId) as { count: number; completed: number } | undefined;
    if (batchRow && batchRow.completed >= batchRow.count) {
      db.prepare("UPDATE batch_jobs SET status = 'complete' WHERE batch_id = ?").run(params.batchId);
      if (params.webhook_url) {
        const fullBatch = buildBatchResponse(params.batchId, db);
        void deliverWebhook(
          params.webhook_url,
          { event: "batch.complete", batch: fullBatch },
          params.webhookSecret ?? undefined,
        );
      }
    }
  };
}

router.post("/", authMiddleware, rateLimitMiddleware, async (c) => {
  const apiKey = c.get("apiKey") as ApiKey;

  if (apiKey.tier === "free") {
    return c.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Batch processing requires Pro tier or above",
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

  const parsed = BatchSchema.safeParse(body);
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

  const { items, webhook_url } = parsed.data;

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

  const batchId = uuidv4();
  const now = new Date().toISOString();
  const db = getDb();

  db.prepare(
    `INSERT INTO batch_jobs (batch_id, status, count, completed, webhook_url, created_at, api_key_id)
     VALUES (?, 'processing', ?, 0, ?, ?, ?)`,
  ).run(batchId, items.length, webhook_url ?? null, now, apiKey.key_id);

  // Higher-tier keys get priority processing: enterprise=2, business=1, pro=0
  const queuePriority = apiKey.tier === "enterprise" ? 2 : apiKey.tier === "business" ? 1 : 0;

  for (const item of items) {
    const jobId = uuidv4();
    const result = validate(item.id, item.country, item.type as TaxIdType);
    const checkedAt = new Date().toISOString();

    db.prepare(
      `INSERT INTO validation_jobs (job_id, status, valid, tax_id, country, type, format_normalized, fraud_risk_score, error, checked_at, api_key_id)
       VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      jobId,
      result.valid ? 1 : 0,
      item.id,
      item.country.toUpperCase(),
      item.type,
      result.normalized,
      result.fraud_risk_score,
      result.error ?? null,
      checkedAt,
      apiKey.key_id,
    );

    db.prepare(
      "INSERT INTO batch_items (item_id, batch_id, ref, job_id) VALUES (?, ?, ?, ?)",
    ).run(uuidv4(), batchId, item.ref, jobId);

    void registryQueue.add(
      processRegistryQueue({
        jobId,
        batchId,
        itemId: item.id,
        itemCountry: item.country.toUpperCase(),
        itemType: item.type as TaxIdType,
        baseScore: result.fraud_risk_score,
        webhook_url,
        webhookSecret: apiKey.webhook_secret,
      }),
      { priority: queuePriority },
    );
  }

  return c.json({ batch_id: batchId, count: items.length, status: "processing" });
});

router.get("/:batch_id", authMiddleware, async (c) => {
  const batchId = c.req.param("batch_id");
  const apiKey = c.get("apiKey") as ApiKey;
  const db = getDb();

  if (!batchId) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Missing batch_id" } }, 400);
  }

  const batch = db
    .prepare("SELECT * FROM batch_jobs WHERE batch_id = ? AND api_key_id = ?")
    .get(batchId, apiKey.key_id) as Record<string, unknown> | undefined;
  if (!batch) {
    return c.json({ error: { code: "NOT_FOUND", message: "Batch not found" } }, 404);
  }

  return c.json(buildBatchResponse(batchId, db));
});

// Business+ only: upload a CSV file (header: ref,id,country,type) for bulk processing
router.post("/csv", authMiddleware, rateLimitMiddleware, async (c) => {
  const apiKey = c.get("apiKey") as ApiKey;

  if (apiKey.tier === "free" || apiKey.tier === "pro") {
    return c.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Bulk CSV upload requires Business tier or above",
          upgrade_url: "/v1/checkout",
        },
      },
      403,
    );
  }

  const contentType = c.req.header("Content-Type") ?? "";
  if (!contentType.includes("text/csv")) {
    return c.json(
      { error: { code: "BAD_REQUEST", message: "Content-Type must be text/csv" } },
      400,
    );
  }

  const csvText = await c.req.text();
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);

  if (lines.length < 2) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "CSV must have a header row and at least one data row",
        },
      },
      422,
    );
  }

  const dataLines = lines.slice(1); // skip header row
  if (dataLines.length > 100) {
    return c.json(
      { error: { code: "VALIDATION_ERROR", message: "CSV upload is limited to 100 rows" } },
      422,
    );
  }

  const items: Array<{ ref: string; id: string; country: string; type: TaxIdType }> = [];
  const validTypes = ["EIN", "VAT", "GST", "ABN", "GSTIN"];
  for (const line of dataLines) {
    const cols = line.split(",").map((col) => col.trim().replace(/^"|"$/g, ""));
    if (cols.length < 4) {
      return c.json(
        { error: { code: "VALIDATION_ERROR", message: `Invalid CSV row: ${line}` } },
        422,
      );
    }
    const [ref, id, country, type] = cols;
    if (!ref || !id || !country || country.length !== 2 || !validTypes.includes(type)) {
      return c.json(
        { error: { code: "VALIDATION_ERROR", message: `Invalid row data: ${line}` } },
        422,
      );
    }
    items.push({ ref, id, country, type: type as TaxIdType });
  }

  const batchId = uuidv4();
  const now = new Date().toISOString();
  const db = getDb();

  db.prepare(
    `INSERT INTO batch_jobs (batch_id, status, count, completed, webhook_url, created_at, api_key_id)
     VALUES (?, 'processing', ?, 0, NULL, ?, ?)`,
  ).run(batchId, items.length, now, apiKey.key_id);

  // Higher-tier keys get priority processing: enterprise=2, business=1, pro=0
  const queuePriority = apiKey.tier === "enterprise" ? 2 : apiKey.tier === "business" ? 1 : 0;

  for (const item of items) {
    const jobId = uuidv4();
    const result = validate(item.id, item.country, item.type);
    const checkedAt = new Date().toISOString();

    db.prepare(
      `INSERT INTO validation_jobs (job_id, status, valid, tax_id, country, type, format_normalized, fraud_risk_score, error, checked_at, api_key_id)
       VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      jobId,
      result.valid ? 1 : 0,
      item.id,
      item.country.toUpperCase(),
      item.type,
      result.normalized,
      result.fraud_risk_score,
      result.error ?? null,
      checkedAt,
      apiKey.key_id,
    );

    db.prepare(
      "INSERT INTO batch_items (item_id, batch_id, ref, job_id) VALUES (?, ?, ?, ?)",
    ).run(uuidv4(), batchId, item.ref, jobId);

    void registryQueue.add(
      processRegistryQueue({
        jobId,
        batchId,
        itemId: item.id,
        itemCountry: item.country.toUpperCase(),
        itemType: item.type,
        baseScore: result.fraud_risk_score,
      }),
      { priority: queuePriority },
    );
  }

  return c.json({ batch_id: batchId, count: items.length, status: "processing" });
});

function buildBatchResponse(
  batchId: string,
  db: ReturnType<typeof getDb>,
): Record<string, unknown> {
  const batch = db
    .prepare("SELECT * FROM batch_jobs WHERE batch_id = ?")
    .get(batchId) as Record<string, unknown>;
  const items = db
    .prepare(
      `SELECT bi.ref, vj.valid, vj.fraud_risk_score, vj.error, vj.registered, vj.business_name, vj.country, vj.type
       FROM batch_items bi
       JOIN validation_jobs vj ON bi.job_id = vj.job_id
       WHERE bi.batch_id = ?`,
    )
    .all(batchId) as Array<Record<string, unknown>>;

  return {
    batch_id: batch.batch_id,
    status: batch.status,
    count: batch.count,
    completed: batch.completed,
    created_at: batch.created_at,
    results: items.map((item) => {
      const isSimulated = !(item.type === "VAT" && VIES_COUNTRIES.has(item.country as string));
      return {
        ref: item.ref,
        valid: Boolean(item.valid),
        fraud_risk_score: item.fraud_risk_score,
        ...(item.error ? { error: item.error } : {}),
        ...(item.registered !== null && item.registered !== undefined
          ? { registered: Boolean(item.registered) }
          : {}),
        ...(item.business_name ? { business_name: item.business_name } : {}),
        data_source: isSimulated ? "simulated" : "live_vies",
      };
    }),
  };
}

export default router;
