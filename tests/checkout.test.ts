import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApp } from "../src/app.js";
import { createTestKey, authHeader } from "./helpers.js";
import { getDb } from "../src/db/client.js";

// Mock the stripe service so tests never need a real STRIPE_SECRET_KEY
vi.mock("../src/services/stripe.js", () => ({
  isStripeConfigured: vi.fn(() => false),
  createCheckoutSession: vi.fn(),
  constructStripeEvent: vi.fn(),
  _resetStripe: vi.fn(),
}));

import * as stripeService from "../src/services/stripe.js";
const mockIsConfigured = vi.mocked(stripeService.isStripeConfigured);
const mockCreateSession = vi.mocked(stripeService.createCheckoutSession);
const mockConstructEvent = vi.mocked(stripeService.constructStripeEvent);

const app = createApp();

describe("POST /v1/checkout — Stripe not configured", () => {
  beforeEach(() => {
    mockIsConfigured.mockReturnValue(false);
  });

  it("returns 503 when Stripe is not configured", async () => {
    const { rawKey } = createTestKey("free");
    const res = await app.request("/v1/checkout", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({
        tier: "pro",
        success_url: "https://example.com/success",
        cancel_url: "https://example.com/cancel",
      }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    const err = body.error as Record<string, unknown>;
    expect(err.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("returns 401 when no API key provided", async () => {
    const res = await app.request("/v1/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "pro", success_url: "https://example.com/s", cancel_url: "https://example.com/c" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /v1/checkout — Stripe configured", () => {
  beforeEach(() => {
    mockIsConfigured.mockReturnValue(true);
    mockCreateSession.mockResolvedValue("https://checkout.stripe.com/pay/cs_test_abc123");
  });

  it("returns 200 with checkout_url for pro upgrade", async () => {
    const { rawKey } = createTestKey("free");
    const res = await app.request("/v1/checkout", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({
        tier: "pro",
        success_url: "https://example.com/success",
        cancel_url: "https://example.com/cancel",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.checkout_url).toBe("https://checkout.stripe.com/pay/cs_test_abc123");
    expect(body.tier).toBe("pro");
  });

  it("returns 200 with checkout_url for enterprise upgrade", async () => {
    const { rawKey } = createTestKey("free");
    const res = await app.request("/v1/checkout", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({
        tier: "enterprise",
        success_url: "https://example.com/success",
        cancel_url: "https://example.com/cancel",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.tier).toBe("enterprise");
  });

  it("returns 409 when key is already on requested tier", async () => {
    const { rawKey } = createTestKey("pro");
    const res = await app.request("/v1/checkout", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({
        tier: "pro",
        success_url: "https://example.com/success",
        cancel_url: "https://example.com/cancel",
      }),
    });
    expect(res.status).toBe(409);
  });

  it("returns 422 for invalid tier", async () => {
    const { rawKey } = createTestKey("free");
    const res = await app.request("/v1/checkout", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({
        tier: "ultra",
        success_url: "https://example.com/success",
        cancel_url: "https://example.com/cancel",
      }),
    });
    expect(res.status).toBe(422);
  });

  it("returns 422 when success_url is missing", async () => {
    const { rawKey } = createTestKey("free");
    const res = await app.request("/v1/checkout", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ tier: "pro", cancel_url: "https://example.com/cancel" }),
    });
    expect(res.status).toBe(422);
  });
});

describe("POST /v1/webhooks/stripe", () => {
  beforeEach(() => {
    mockIsConfigured.mockReturnValue(true);
  });

  it("returns 400 when Stripe-Signature header is missing", async () => {
    const res = await app.request("/v1/webhooks/stripe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 401 when signature is invalid", async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error("Invalid signature");
    });
    const res = await app.request("/v1/webhooks/stripe", {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": "bad_sig" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("upgrades key tier on checkout.session.completed", async () => {
    const { keyId } = createTestKey("free");

    // Simulate a valid Stripe event (double-cast needed: plain object → Stripe.Event)
    mockConstructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { key_id: keyId, tier: "pro" },
          customer: "cus_test123",
          subscription: "sub_test456",
        },
      },
    } as unknown as ReturnType<typeof stripeService.constructStripeEvent>);

    const res = await app.request("/v1/webhooks/stripe", {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": "t=123,v1=abc" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.received).toBe(true);

    // Verify the key was actually upgraded in the DB
    const db = getDb();
    const key = db.prepare("SELECT tier, daily_limit FROM api_keys WHERE key_id = ?").get(keyId) as
      | { tier: string; daily_limit: number }
      | undefined;
    expect(key?.tier).toBe("pro");
    expect(key?.daily_limit).toBe(1000);
  });

  it("returns 200 (no retry) when metadata is missing key_id", async () => {
    mockConstructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: { metadata: {} } },
    } as unknown as ReturnType<typeof stripeService.constructStripeEvent>);

    const res = await app.request("/v1/webhooks/stripe", {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": "t=123,v1=abc" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });
});
