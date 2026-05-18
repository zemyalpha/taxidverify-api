import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";
import { createTestKey, authHeader } from "./helpers.js";
import { getDb } from "../src/db/client.js";

const app = createApp();

describe("rate limiting", () => {
  it("returns 429 when daily_used >= daily_limit", async () => {
    const { rawKey } = createTestKey("free", { daily_used: 50 });
    const res = await app.request("/v1/validate", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
    });
    expect(res.status).toBe(429);
    const body = (await res.json()) as Record<string, unknown>;
    const err = body.error as Record<string, unknown>;
    expect(err.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("includes Retry-After header", async () => {
    const { rawKey } = createTestKey("free", { daily_used: 50 });
    const res = await app.request("/v1/validate", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).not.toBeNull();
  });

  it("resets daily_used after reset_at passes", async () => {
    const pastReset = new Date(Date.now() - 1000 * 60).toISOString();
    const { rawKey, keyId } = createTestKey("free", { daily_used: 50, reset_at: pastReset });

    const res = await app.request("/v1/validate", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
    });
    expect(res.status).toBe(200);

    const db = getDb();
    const updated = db.prepare("SELECT daily_used, reset_at FROM api_keys WHERE key_id = ?").get(keyId) as {
      daily_used: number;
      reset_at: string;
    };
    // After reset, the request that triggered reset becomes the first one (1 used)
    expect(updated.daily_used).toBe(1);
    expect(new Date(updated.reset_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("increments daily_used on each request", async () => {
    const { rawKey, keyId } = createTestKey("free");
    const db = getDb();

    await app.request("/v1/validate", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
    });
    const after1 = db.prepare("SELECT daily_used FROM api_keys WHERE key_id = ?").get(keyId) as {
      daily_used: number;
    };
    expect(after1.daily_used).toBe(1);

    await app.request("/v1/validate", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
    });
    const after2 = db.prepare("SELECT daily_used FROM api_keys WHERE key_id = ?").get(keyId) as {
      daily_used: number;
    };
    expect(after2.daily_used).toBe(2);
  });
});
