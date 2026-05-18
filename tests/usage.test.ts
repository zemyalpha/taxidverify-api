import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";
import { createTestKey, authHeader } from "./helpers.js";
import { registryQueue } from "../src/services/queue.js";

const app = createApp();

describe("GET /v1/usage", () => {
  it("returns usage stats for a fresh key", async () => {
    const { rawKey } = createTestKey("free");
    const res = await app.request("/v1/usage", {
      method: "GET",
      headers: authHeader(rawKey),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.daily_used).toBe(0);
    expect(body.daily_limit).toBe(50);
    expect(typeof body.reset_at).toBe("string");
    expect(body.tier).toBe("free");
    expect(body.billing_cycle).toBe("monthly");
    expect(Array.isArray(body.history)).toBe(true);
  });

  it("returns 401 without auth", async () => {
    const res = await app.request("/v1/usage", { method: "GET" });
    expect(res.status).toBe(401);
  });

  it("reflects daily_used after validate calls", async () => {
    const { rawKey } = createTestKey("free");
    await app.request("/v1/validate", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
    });
    await app.request("/v1/validate", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
    });

    const res = await app.request("/v1/usage", {
      method: "GET",
      headers: authHeader(rawKey),
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.daily_used).toBe(2);
  });

  it("history includes today's usage after validate calls", async () => {
    const { rawKey } = createTestKey("pro");
    await app.request("/v1/validate", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
    });
    await registryQueue.onIdle();

    const res = await app.request("/v1/usage", {
      method: "GET",
      headers: authHeader(rawKey),
    });
    const body = (await res.json()) as Record<string, unknown>;
    const history = body.history as Array<{ date: string; count: number }>;
    expect(history.length).toBeGreaterThan(0);
    const total = history.reduce((s, h) => s + h.count, 0);
    expect(total).toBeGreaterThanOrEqual(1);
  });

  it("returns correct daily_limit for pro tier", async () => {
    const { rawKey } = createTestKey("pro");
    const res = await app.request("/v1/usage", {
      method: "GET",
      headers: authHeader(rawKey),
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.daily_limit).toBe(1000);
    expect(body.tier).toBe("pro");
  });

  it("returns correct daily_limit for business tier", async () => {
    const { rawKey } = createTestKey("business");
    const res = await app.request("/v1/usage", {
      method: "GET",
      headers: authHeader(rawKey),
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.daily_limit).toBe(5000);
    expect(body.tier).toBe("business");
  });

  it("history is an empty array when no calls made", async () => {
    const { rawKey } = createTestKey("free");
    const res = await app.request("/v1/usage", {
      method: "GET",
      headers: authHeader(rawKey),
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.history).toEqual([]);
  });
});
