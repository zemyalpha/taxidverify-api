import Stripe from "stripe";
import pino from "pino";
import type { ApiKeyTier, BillingCycle } from "../types/index.js";

const logger = pino({ name: "stripe" });

let _stripe: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    _stripe = new Stripe(key, { apiVersion: "2024-06-20" });
  }
  return _stripe;
}

// Monthly amounts in cents
const MONTHLY_AMOUNTS: Record<Exclude<ApiKeyTier, "free">, number> = {
  pro: 2900,          // $29.00/mo
  business: 9900,     // $99.00/mo
  enterprise: 49900,  // $499.00/mo
};

// Annual amounts = monthly * 12 * 0.8 (20% discount)
const ANNUAL_AMOUNTS: Record<Exclude<ApiKeyTier, "free">, number> = {
  pro: Math.round(2900 * 12 * 0.8),          // $278.40/yr
  business: Math.round(9900 * 12 * 0.8),     // $950.40/yr
  enterprise: Math.round(49900 * 12 * 0.8),  // $4,790.40/yr
};

const TIER_DESCRIPTIONS: Record<Exclude<ApiKeyTier, "free">, string> = {
  pro: "1,000 verifications/day · Validate + Verify + Batch + Webhook",
  business: "5,000 verifications/day · Priority queue + Bulk CSV upload + Webhook",
  enterprise: "50,000 verifications/day · Dedicated support + Custom SLA + All features",
};

function getPriceId(tier: Exclude<ApiKeyTier, "free">, billingCycle: BillingCycle): string | undefined {
  if (billingCycle === "annual") {
    const key = `STRIPE_PRICE_${tier.toUpperCase()}_ANNUAL` as keyof NodeJS.ProcessEnv;
    return process.env[key] as string | undefined;
  }
  const key = `STRIPE_PRICE_${tier.toUpperCase()}` as keyof NodeJS.ProcessEnv;
  return process.env[key] as string | undefined;
}

export async function createCheckoutSession(
  keyId: string,
  tier: Exclude<ApiKeyTier, "free">,
  successUrl: string,
  cancelUrl: string,
  billingCycle: BillingCycle = "monthly",
): Promise<string> {
  const stripe = getStripe();
  const priceId = getPriceId(tier, billingCycle);
  const isAnnual = billingCycle === "annual";
  const amount = isAnnual ? ANNUAL_AMOUNTS[tier] : MONTHLY_AMOUNTS[tier];
  const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);

  const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = priceId
    ? { price: priceId, quantity: 1 }
    : {
        price_data: {
          currency: "usd",
          unit_amount: amount,
          recurring: { interval: isAnnual ? "year" : "month" },
          product_data: {
            name: `TaxIDVerify ${tierLabel}${isAnnual ? " (Annual)" : ""}`,
            description:
              TIER_DESCRIPTIONS[tier] +
              (isAnnual ? " — 20% annual discount applied" : ""),
          },
        },
        quantity: 1,
      };

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [lineItem],
    metadata: { key_id: keyId, tier, billing_cycle: billingCycle },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  logger.info({ keyId, tier, billingCycle, sessionId: session.id }, "Stripe checkout session created");
  return session.url;
}

export function constructStripeEvent(payload: string, signature: string): Stripe.Event {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  return getStripe().webhooks.constructEvent(payload, signature, webhookSecret);
}

/** Reset the singleton (for testing). */
export function _resetStripe(): void {
  _stripe = null;
}
