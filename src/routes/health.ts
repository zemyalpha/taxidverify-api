import { Hono } from "hono";
import { getDb } from "../db/client.js";

const router = new Hono();

const startTime = Date.now();

router.get("/", (c) => {
  let dbOk = false;
  try {
    getDb().prepare("SELECT 1").get();
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

  return c.json(
    {
      status: dbOk ? "ok" : "degraded",
      uptime_seconds: uptimeSeconds,
      db: dbOk ? "connected" : "error",
      timestamp: new Date().toISOString(),
    },
    dbOk ? 200 : 503,
  );
});

export default router;
