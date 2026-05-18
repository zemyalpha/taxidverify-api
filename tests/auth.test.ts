import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";
import { createTestKey, authHeader } from "./helpers.js";

const app = createApp();

describe("auth middleware", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const res = await app.request("/v1/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    const err = body.error as Record<string, unknown>;
    expect(err.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 when key format is too short", async () => {
    const res = await app.request("/v1/validate", {
      method: "POST",
      headers: { Authorization: "Bearer short", "Content-Type": "application/json" },
      body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when key does not exist", async () => {
    const fakeKey = "a".repeat(64);
    const res = await app.request("/v1/validate", {
      method: "POST",
      headers: { Authorization: `Bearer ${fakeKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization is not Bearer scheme", async () => {
    const res = await app.request("/v1/validate", {
      method: "POST",
      headers: { Authorization: "Basic abc", "Content-Type": "application/json" },
      body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
    });
    expect(res.status).toBe(401);
  });

  it("passes through with a valid key", async () => {
    const { rawKey } = createTestKey("free");
    const res = await app.request("/v1/validate", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
    });
    expect(res.status).toBe(200);
  });
});
