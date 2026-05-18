import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import pino from "pino";
import { randomUUID } from "node:crypto";
import keysRouter from "./routes/keys.js";
import validateRouter from "./routes/validate.js";
import verifyRouter from "./routes/verify.js";
import batchRouter from "./routes/batch.js";
import healthRouter from "./routes/health.js";
import usageRouter from "./routes/usage.js";
import checkoutRouter from "./routes/checkout.js";
import stripeWebhookRouter from "./routes/stripe-webhook.js";

const logger = pino({ name: "taxidverify", level: process.env.LOG_LEVEL ?? "info" });

export function createApp(): Hono {
  const app = new Hono();

  // Security headers
  app.use(secureHeaders());
  app.use(cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }));

  // Request logging
  app.use(async (c, next) => {
    const requestId = randomUUID();
    const start = Date.now();
    c.set("requestId", requestId);
    await next();
    const latency = Date.now() - start;
    logger.info({
      request_id: requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      latency_ms: latency,
    });
  });

  // Routes
  app.route("/health", healthRouter);
  app.route("/v1/keys", keysRouter);
  app.route("/v1/validate", validateRouter);
  app.route("/v1/verify", verifyRouter);
  app.route("/v1/batch", batchRouter);
  app.route("/v1/usage", usageRouter);
  app.route("/v1/checkout", checkoutRouter);
  app.route("/v1/webhooks/stripe", stripeWebhookRouter);

  // 404 handler
  app.notFound((c) =>
    c.json({ error: { code: "NOT_FOUND", message: "Endpoint not found" } }, 404),
  );

  // Error handler
  app.onError((err, c) => {
    logger.error({ err, request_id: c.get("requestId") }, "Unhandled error");
    return c.json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }, 500);
  });

  return app;
}
