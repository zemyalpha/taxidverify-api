import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";

const app = createApp();

describe("POST /v1/keys", () => {
  it("creates a new API key with valid email", async () => {
    const res = await app.request("/v1/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.api_key).toBeDefined();
    expect(typeof body.api_key).toBe("string");
    expect((body.api_key as string).length).toBeGreaterThanOrEqual(32);
    expect(body.key_id).toBeDefined();
    expect(body.tier).toBe("free");
    expect(body.daily_limit).toBe(50);
    expect(body.webhook_secret).toBeDefined();
  });

  it("returns 422 for invalid email", async () => {
    const res = await app.request("/v1/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBeDefined();
  });

  it("always creates free tier regardless of tier field", async () => {
    const res = await app.request("/v1/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "default@example.com" }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.tier).toBe("free");
    expect(body.daily_limit).toBe(50);
  });

  it("returns 201 with message explaining key is shown once", async () => {
    const res = await app.request("/v1/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "once@example.com" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.message).toBe("string");
  });

  it("returns webhook_secret in response", async () => {
    const res = await app.request("/v1/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "webhook@example.com" }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.webhook_secret).toBeDefined();
    expect(typeof body.webhook_secret).toBe("string");
  });

  it("returns 400 for invalid JSON", async () => {
    const res = await app.request("/v1/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  it("ignores unknown fields and always returns free tier", async () => {
    // tier field is no longer accepted — upgrades require Stripe checkout
    const res = await app.request("/v1/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "tier@example.com", tier: "enterprise" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.tier).toBe("free");
    expect(body.daily_limit).toBe(50);
  });

  it("rate-limits registration at 10 per IP per hour", async () => {
    const ip = "1.2.3.4";
    const headers = { "Content-Type": "application/json", "X-Forwarded-For": ip };

    for (let i = 0; i < 10; i++) {
      const res = await app.request("/v1/keys", {
        method: "POST",
        headers,
        body: JSON.stringify({ email: `user${i}@example.com` }),
      });
      expect(res.status).toBe(201);
    }

    // 11th request from same IP must be blocked
    const blocked = await app.request("/v1/keys", {
      method: "POST",
      headers,
      body: JSON.stringify({ email: "blocked@example.com" }),
    });
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as Record<string, unknown>;
    expect((body.error as Record<string, unknown>).code).toBe("RATE_LIMIT_EXCEEDED");
    expect(blocked.headers.get("Retry-After")).toBe("3600");
  });

  it("different IPs are rate-limited independently", async () => {
    const headers1 = { "Content-Type": "application/json", "X-Forwarded-For": "5.6.7.8" };
    const headers2 = { "Content-Type": "application/json", "X-Forwarded-For": "9.10.11.12" };

    // Exhaust limit for IP1
    for (let i = 0; i < 10; i++) {
      await app.request("/v1/keys", {
        method: "POST",
        headers: headers1,
        body: JSON.stringify({ email: `ip1user${i}@example.com` }),
      });
    }

    // IP2 should still be allowed
    const res = await app.request("/v1/keys", {
      method: "POST",
      headers: headers2,
      body: JSON.stringify({ email: "ip2user@example.com" }),
    });
    expect(res.status).toBe(201);
  });
});
