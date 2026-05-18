import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";
import { createTestKey, authHeader } from "./helpers.js";
import { getDb } from "../src/db/client.js";

const app = createApp();

describe("overage billing", () => {
  it("paid subscriber gets through when daily limit is reached (no 429)", async () => {
    const { rawKey } = createTestKey("pro", {
      daily_used: 1000,
      stripe_subscription_id: "sub_test_overage",
    });
    const res = await app.request("/v1/validate", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
    });
    expect(res.status).toBe(200);
  });

  it("overage response includes X-Overage-Charge: 0.02 header", async () => {
    const { rawKey } = createTestKey("pro", {
      daily_used: 1000,
      stripe_subscription_id: "sub_test_header",
    });
    const res = await app.request("/v1/validate", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
    });
    expect(res.headers.get("X-Overage-Charge")).toBe("0.02");
  });

  it("overage_used increments in DB on each overage call", async () => {
    const { rawKey, keyId } = createTestKey("pro", {
      daily_used: 1000,
      stripe_subscription_id: "sub_test_increment",
    });
    const db = getDb();

    await app.request("/v1/validate", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
    });
    const after1 = db
      .prepare("SELECT overage_used FROM api_keys WHERE key_id = ?")
      .get(keyId) as { overage_used: number };
    expect(after1.overage_used).toBe(1);

    await app.request("/v1/validate", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
    });
    const after2 = db
      .prepare("SELECT overage_used FROM api_keys WHERE key_id = ?")
      .get(keyId) as { overage_used: number };
    expect(after2.overage_used).toBe(2);
  });

  it("free tier still receives 429 when daily limit is reached", async () => {
    const { rawKey } = createTestKey("free", { daily_used: 50 });
    const res = await app.request("/v1/validate", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("X-Overage-Charge")).toBeNull();
  });

  it("429 response includes upgrade_message field", async () => {
    const { rawKey } = createTestKey("free", { daily_used: 50 });
    const res = await app.request("/v1/validate", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
    });
    expect(res.status).toBe(429);
    const body = (await res.json()) as Record<string, unknown>;
    const err = body.error as Record<string, unknown>;
    expect(err.upgrade_message).toBeDefined();
    expect(typeof err.upgrade_message).toBe("string");
  });
});

describe("GET /v1/usage/overage", () => {
  it("returns zero overage for new key", async () => {
    const { rawKey } = createTestKey("pro");
    const res = await app.request("/v1/usage/overage", {
      method: "GET",
      headers: authHeader(rawKey),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.overage_calls).toBe(0);
    expect(body.overage_cost_usd).toBe("0.00");
    expect(body.rate_per_call_usd).toBe("0.02");
  });

  it("returns correct overage cost after paid overage calls", async () => {
    const { rawKey, keyId } = createTestKey("pro", {
      daily_used: 1000,
      stripe_subscription_id: "sub_usage_overage",
    });

    // Make 3 overage calls
    for (let i = 0; i < 3; i++) {
      await app.request("/v1/validate", {
        method: "POST",
        headers: authHeader(rawKey),
        body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
      });
    }

    const res = await app.request("/v1/usage/overage", {
      method: "GET",
      headers: authHeader(rawKey),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.overage_calls).toBe(3);
    expect(body.overage_cost_usd).toBe("0.06");
    expect(body).toHaveProperty("billing_period");
    const period = body.billing_period as Record<string, unknown>;
    expect(period.start).toBeDefined();
    expect(period.end).toBeDefined();

    // Suppress unused variable warning
    void keyId;
  });

  it("returns 401 without auth", async () => {
    const res = await app.request("/v1/usage/overage", { method: "GET" });
    expect(res.status).toBe(401);
  });
});
