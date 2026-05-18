import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";
import { createTestKey, authHeader } from "./helpers.js";
import { registryQueue } from "../src/services/queue.js";

const app = createApp();

describe("POST /v1/batch", () => {
  it("returns batch_id for 2 items", async () => {
    const { rawKey } = createTestKey("pro");
    const res = await app.request("/v1/batch", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({
        items: [
          { ref: "a", id: "12-3456789", country: "US", type: "EIN" },
          { ref: "b", id: "98-7654321", country: "US", type: "EIN" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.batch_id).toBeDefined();
    expect(body.count).toBe(2);
    expect(body.status).toBe("processing");
    await registryQueue.onIdle();
  });

  it("returns 422 for 101 items (exceeds max)", async () => {
    const { rawKey } = createTestKey("pro");
    const items = Array.from({ length: 101 }, (_, i) => ({
      ref: `r${i}`,
      id: "12-3456789",
      country: "US",
      type: "EIN",
    }));
    const res = await app.request("/v1/batch", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ items }),
    });
    expect(res.status).toBe(422);
  });

  it("returns 422 for empty items array", async () => {
    const { rawKey } = createTestKey("pro");
    const res = await app.request("/v1/batch", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({ items: [] }),
    });
    expect(res.status).toBe(422);
  });

  it("returns 403 for free tier", async () => {
    const { rawKey } = createTestKey("free");
    const res = await app.request("/v1/batch", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({
        items: [{ ref: "a", id: "12-3456789", country: "US", type: "EIN" }],
      }),
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /v1/batch/:batch_id", () => {
  it("returns batch with results", async () => {
    const { rawKey } = createTestKey("pro");
    const submit = await app.request("/v1/batch", {
      method: "POST",
      headers: authHeader(rawKey),
      body: JSON.stringify({
        items: [
          { ref: "a", id: "12-3456789", country: "US", type: "EIN" },
          { ref: "b", id: "00-1234567", country: "US", type: "EIN" },
        ],
      }),
    });
    const submitBody = (await submit.json()) as Record<string, unknown>;
    const batchId = submitBody.batch_id as string;

    // Wait for all queued registry work to drain so status is 'complete'
    await registryQueue.onIdle();

    const res = await app.request(`/v1/batch/${batchId}`, {
      method: "GET",
      headers: authHeader(rawKey),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.batch_id).toBe(batchId);
    expect(body.count).toBe(2);
    const results = body.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(2);
    const refs = results.map((r) => r.ref).sort();
    expect(refs).toEqual(["a", "b"]);
  });

  it("returns 404 for non-existent batch", async () => {
    const { rawKey } = createTestKey("pro");
    const res = await app.request("/v1/batch/00000000-0000-0000-0000-000000000000", {
      method: "GET",
      headers: authHeader(rawKey),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for another user's batch", async () => {
    const a = createTestKey("pro");
    const b = createTestKey("pro");
    const submit = await app.request("/v1/batch", {
      method: "POST",
      headers: authHeader(a.rawKey),
      body: JSON.stringify({
        items: [{ ref: "a", id: "12-3456789", country: "US", type: "EIN" }],
      }),
    });
    const submitBody = (await submit.json()) as Record<string, unknown>;
    const batchId = submitBody.batch_id as string;
    await registryQueue.onIdle();

    const res = await app.request(`/v1/batch/${batchId}`, {
      method: "GET",
      headers: authHeader(b.rawKey),
    });
    expect(res.status).toBe(404);
  });
});
