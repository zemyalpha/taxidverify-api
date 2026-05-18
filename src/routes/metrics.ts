import { Hono } from "hono";
import { getDb } from "../db/client.js";
import { getMetrics } from "../lib/metrics.js";

const router = new Hono();

router.get("/", (c) => {
  const metricsKey = process.env.METRICS_API_KEY;
  if (!metricsKey) {
    return c.json({ error: { code: "SERVICE_UNAVAILABLE", message: "METRICS_API_KEY is not configured." } }, 503);
  }
  const provided = c.req.header("X-Metrics-Api-Key");
  if (provided !== metricsKey) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Invalid or missing X-Metrics-Api-Key header." } }, 401);
  }

  const db = getDb();
  const m = getMetrics();

  const avgLatency =
    m.latency_count > 0 ? m.latency_sum_ms / m.latency_count / 1000 : 0;

  const quotaUsage = db
    .prepare(
      "SELECT COALESCE(SUM(daily_used), 0) as used, COALESCE(SUM(daily_limit), 0) as total FROM api_keys",
    )
    .get() as { used: number; total: number };

  const overageTotal = db
    .prepare("SELECT COALESCE(SUM(overage_used), 0) as total FROM api_keys")
    .get() as { total: number };

  const statusLines: string[] = [];
  for (const [status, count] of m.requests_by_status) {
    statusLines.push(`requests_total{status="${status}"} ${count}`);
  }
  if (statusLines.length === 0) {
    statusLines.push(`requests_total{status="200"} 0`);
  }

  const lines = [
    "# HELP requests_total Total HTTP requests handled",
    "# TYPE requests_total counter",
    ...statusLines,
    "",
    "# HELP latency_seconds Average request latency in seconds",
    "# TYPE latency_seconds gauge",
    `latency_seconds ${avgLatency.toFixed(6)}`,
    "",
    "# HELP quota_usage_calls Daily quota consumption across all API keys",
    "# TYPE quota_usage_calls gauge",
    `quota_usage_calls{type="used"} ${quotaUsage.used}`,
    `quota_usage_calls{type="limit"} ${quotaUsage.total}`,
    `quota_usage_calls{type="overage"} ${overageTotal.total}`,
  ];

  c.header("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  return c.text(lines.join("\n") + "\n");
});

export default router;
