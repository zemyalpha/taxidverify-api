import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/utils/ssrf.js", () => ({
  validateWebhookUrl: vi.fn().mockResolvedValue(undefined),
  SSRFError: class SSRFError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "SSRFError";
    }
  },
}));

import { createApp } from "../src/app.js";
import { createTestKey, authHeader } from "./helpers.js";
import { validateWebhookUrl } from "../src/utils/ssrf.js";

const app = createApp();

beforeEach(() => {
  vi.mocked(validateWebhookUrl).mockResolvedValue(undefined);
});

describe("POST /v1/usage/alert", () => {
  it("saves a usage alert with valid threshold and webhook URL", async () => {
    const { rawKey } = createTestKey("pro");
    const res = await app.request("/v1/usage/alert", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({
        threshold_percent: 80,
        webhook_url: "https://example.com/alert-hook",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.threshold_percent).toBe(80);
    expect(body.webhook_url).toBe("https://example.com/alert-hook");
    expect(typeof body.message).toBe("string");
  });

  it("accepts boundary value 50", async () => {
    const { rawKey } = createTestKey("free");
    const res = await app.request("/v1/usage/alert", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ threshold_percent: 50, webhook_url: "https://example.com/hook" }),
    });
    expect(res.status).toBe(200);
  });

  it("accepts boundary value 90", async () => {
    const { rawKey } = createTestKey("free");
    const res = await app.request("/v1/usage/alert", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ threshold_percent: 90, webhook_url: "https://example.com/hook" }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 422 for threshold below 50", async () => {
    const { rawKey } = createTestKey("pro");
    const res = await app.request("/v1/usage/alert", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ threshold_percent: 40, webhook_url: "https://example.com/hook" }),
    });
    expect(res.status).toBe(422);
  });

  it("returns 422 for threshold above 90", async () => {
    const { rawKey } = createTestKey("pro");
    const res = await app.request("/v1/usage/alert", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ threshold_percent: 95, webhook_url: "https://example.com/hook" }),
    });
    expect(res.status).toBe(422);
  });

  it("returns 422 for invalid (non-URL) webhook_url", async () => {
    const { rawKey } = createTestKey("pro");
    const res = await app.request("/v1/usage/alert", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ threshold_percent: 75, webhook_url: "not-a-url" }),
    });
    expect(res.status).toBe(422);
  });

  it("returns 422 when SSRF check rejects the webhook URL", async () => {
    vi.mocked(validateWebhookUrl).mockRejectedValueOnce(
      new Error("URL must not point to a private or reserved IP address"),
    );
    const { rawKey } = createTestKey("pro");
    const res = await app.request("/v1/usage/alert", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ threshold_percent: 75, webhook_url: "http://192.168.1.1/hook" }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body.error as Record<string, unknown>).code).toBe("INVALID_WEBHOOK_URL");
  });

  it("returns 401 without authentication", async () => {
    const res = await app.request("/v1/usage/alert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threshold_percent: 75, webhook_url: "https://example.com/hook" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid JSON", async () => {
    const { rawKey } = createTestKey("free");
    const res = await app.request("/v1/usage/alert", {
      method: "POST",
      headers: authHeader(rawKey),
      body: "{invalid",
    });
    expect(res.status).toBe(400);
  });
});
