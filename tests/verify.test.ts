import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";
import { createTestKey, authHeader } from "./helpers.js";
import { registryQueue } from "../src/services/queue.js";

const app = createApp();

describe("POST /v1/verify", () => {
  it("returns job_id with status=pending for a pro key", async () => {
    const { rawKey } = createTestKey("pro");
    const res = await app.request("/v1/verify", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.job_id).toBeDefined();
    expect(body.status).toBe("pending");
    expect(body.valid).toBe(true);
    // Let any queued work finish to avoid leaking promises across tests
    await registryQueue.onIdle();
  });

  it("returns 403 for free tier", async () => {
    const { rawKey } = createTestKey("free");
    const res = await app.request("/v1/verify", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    const err = body.error as Record<string, unknown>;
    expect(err.code).toBe("FORBIDDEN");
  });

  it("returns 422 for invalid body", async () => {
    const { rawKey } = createTestKey("pro");
    const res = await app.request("/v1/verify", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ id: "12-3456789" }),
    });
    expect(res.status).toBe(422);
  });
});

describe("GET /v1/verify/:job_id", () => {
  it("returns job details for an existing job", async () => {
    const { rawKey } = createTestKey("pro");
    const submit = await app.request("/v1/verify", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
    });
    const submitBody = (await submit.json()) as Record<string, unknown>;
    const jobId = submitBody.job_id as string;

    // Wait for any queued registry work so the row is in a stable state
    await registryQueue.onIdle();

    const res = await app.request(`/v1/verify/${jobId}`, {
      method: "GET",
      headers: authHeader(rawKey),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.job_id).toBe(jobId);
    expect(body.id).toBe("12-3456789");
    expect(body.valid).toBe(true);
  });

  it("returns 404 for non-existent job", async () => {
    const { rawKey } = createTestKey("pro");
    const res = await app.request("/v1/verify/00000000-0000-0000-0000-000000000000", {
      method: "GET",
      headers: authHeader(rawKey),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for another user's job", async () => {
    const a = createTestKey("pro");
    const b = createTestKey("pro");
    const submit = await app.request("/v1/verify", {
      method: "POST",
      headers: authHeader(a.rawKey),
      body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
    });
    const submitBody = (await submit.json()) as Record<string, unknown>;
    const jobId = submitBody.job_id as string;
    await registryQueue.onIdle();

    const res = await app.request(`/v1/verify/${jobId}`, {
      method: "GET",
      headers: authHeader(b.rawKey),
    });
    expect(res.status).toBe(404);
  });
});
