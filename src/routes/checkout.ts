import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { createCheckoutSession, isStripeConfigured } from "../services/stripe.js";
import type { ApiKey } from "../types/index.js";

const router = new Hono();

const CheckoutSchema = z.object({
  tier: z.enum(["business", "pro", "enterprise"]),
  billing_cycle: z.enum(["monthly", "annual"]).default("monthly"),
  success_url: z.string().url().max(500),
  cancel_url: z.string().url().max(500),
});

router.post("/", authMiddleware, async (c) => {
  if (!isStripeConfigured()) {
    return c.json(
      {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Payment processing is not configured. Contact support to upgrade your tier.",
        },
      },
      503,
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid JSON body" } }, 400);
  }

  const parsed = CheckoutSchema.safeParse(body);
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

  const apiKey = c.get("apiKey") as ApiKey;
  const { tier, billing_cycle, success_url, cancel_url } = parsed.data;

  if (apiKey.tier === tier && (apiKey.billing_cycle ?? "monthly") === billing_cycle) {
    return c.json(
      {
        error: {
          code: "CONFLICT",
          message: `Your key is already on the ${tier} tier (${billing_cycle})`,
        },
      },
      409,
    );
  }

  try {
    const checkoutUrl = await createCheckoutSession(
      apiKey.key_id,
      tier,
      success_url,
      cancel_url,
      billing_cycle,
    );
    return c.json({ checkout_url: checkoutUrl, tier, billing_cycle });
  } catch {
    return c.json(
      { error: { code: "PAYMENT_ERROR", message: "Failed to create checkout session" } },
      502,
    );
  }
});

export default router;
