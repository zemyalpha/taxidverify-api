import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";

const app = createApp();

describe("GET /health", () => {
  it("returns 200 with ok status when db is connected", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.db).toBe("connected");
  });

  it("includes uptime_seconds as a non-negative number", async () => {
    const res = await app.request("/health");
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.uptime_seconds).toBe("number");
    expect(body.uptime_seconds as number).toBeGreaterThanOrEqual(0);
  });

  it("includes a valid ISO timestamp", async () => {
    const before = Date.now();
    const res = await app.request("/health");
    const after = Date.now();
    const body = (await res.json()) as Record<string, unknown>;
    const ts = new Date(body.timestamp as string).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("is accessible without authentication", async () => {
    const res = await app.request("/health");
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
