import { Hono } from "hono";
import pino from "pino";
import { getDb } from "../db/client.js";
import { constructStripeEvent, isStripeConfigured } from "../services/stripe.js";

const logger = pino({ name: "stripe-webhook" });
const router = new Hono();

const TIER_LIMITS: Record<string, number> = {
  pro: 1000,
  business: 5000,
  enterprise: 50000,
};

router.post("/", async (c) => {
  if (!isStripeConfigured()) {
    return c.json(
      { error: { code: "SERVICE_UNAVAILABLE", message: "Stripe is not configured" } },
      503,
    );
  }

  const signature = c.req.header("stripe-signature");
  if (!signature) {
    return c.json(
      { error: { code: "BAD_REQUEST", message: "Missing Stripe-Signature header" } },
      400,
    );
  }

  const rawBody = await c.req.text();

  let event: ReturnType<typeof constructStripeEvent>;
  try {
    event = constructStripeEvent(rawBody, signature);
  } catch (err) {
    logger.warn({ err }, "Invalid Stripe webhook signature");
    return c.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid webhook signature" } },
      401,
    );
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as {
      metadata?: Record<string, string>;
      customer?: string | null;
      subscription?: string | null;
    };

    const keyId = session.metadata?.key_id;
    const tier = session.metadata?.tier;
    const billingCycle = session.metadata?.billing_cycle ?? "monthly";

    if (!keyId || !tier || !["business", "pro", "enterprise"].includes(tier)) {
      logger.warn({ metadata: session.metadata }, "Stripe webhook: missing or invalid metadata");
      // Return 200 so Stripe does not retry with the same broken event
      return c.json({ received: true });
    }

    const db = getDb();
    const newLimit = TIER_LIMITS[tier];
    db.prepare(
      `UPDATE api_keys
       SET tier = ?, daily_limit = ?, stripe_customer_id = ?, stripe_subscription_id = ?, billing_cycle = ?
       WHERE key_id = ?`,
    ).run(tier, newLimit, session.customer ?? null, session.subscription ?? null, billingCycle, keyId);

    logger.info({ keyId, tier }, "API key upgraded via Stripe checkout");
  }

  return c.json({ received: true });
});

export default router;
