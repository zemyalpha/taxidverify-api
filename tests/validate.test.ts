import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";
import { createTestKey, authHeader } from "./helpers.js";

const app = createApp();

describe("POST /v1/validate", () => {
  it("returns valid=true for a valid EIN", async () => {
    const { rawKey } = createTestKey("free");
    const res = await app.request("/v1/validate", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.valid).toBe(true);
    expect(body.format_normalized).toBe("12-3456789");
    expect(body.country).toBe("US");
    expect(body.type).toBe("EIN");
  });

  it("returns valid=false for an invalid EIN", async () => {
    const { rawKey } = createTestKey("free");
    const res = await app.request("/v1/validate", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ id: "00-1234567", country: "US", type: "EIN" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.valid).toBe(false);
    expect(body.error).toBe("ein_prefix_invalid");
  });

  it("returns 422 when fields are missing", async () => {
    const { rawKey } = createTestKey("free");
    const res = await app.request("/v1/validate", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ id: "12-3456789" }),
    });
    expect(res.status).toBe(422);
  });

  it("includes fraud_risk_score in response", async () => {
    const { rawKey } = createTestKey("free");
    const res = await app.request("/v1/validate", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.fraud_risk_score).toBeDefined();
    expect(typeof body.fraud_risk_score).toBe("number");
  });

  it("free tier can use validate", async () => {
    const { rawKey } = createTestKey("free");
    const res = await app.request("/v1/validate", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 401 without auth", async () => {
    const res = await app.request("/v1/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid JSON body", async () => {
    const { rawKey } = createTestKey("free");
    const res = await app.request("/v1/validate", {
      method: "POST",
      headers: authHeader(rawKey),
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  it("returns 422 for invalid type enum", async () => {
    const { rawKey } = createTestKey("free");
    const res = await app.request("/v1/validate", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ id: "12-3456789", country: "US", type: "BOGUS" }),
    });
    expect(res.status).toBe(422);
  });

  it("uppercases country code in response", async () => {
    const { rawKey } = createTestKey("free");
    const res = await app.request("/v1/validate", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ id: "12-3456789", country: "us", type: "EIN" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.country).toBe("US");
  });
});
