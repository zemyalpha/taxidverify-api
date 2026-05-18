import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";
import { createTestKey, authHeader } from "./helpers.js";
import { registryQueue } from "../src/services/queue.js";

const app = createApp();

const CSV_HEADER = "ref,id,country,type";
const VALID_CSV = `${CSV_HEADER}\ncust-1,12-3456789,US,EIN\ncust-2,98-7654321,US,EIN`;

describe("POST /v1/batch/csv", () => {
  it("returns batch_id for valid CSV (business tier)", async () => {
    const { rawKey } = createTestKey("business");
    const res = await app.request("/v1/batch/csv", {
      method: "POST",
      headers: { Authorization: `Bearer ${rawKey}`, "Content-Type": "text/csv" },
      body: VALID_CSV,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.batch_id).toBeDefined();
    expect(body.count).toBe(2);
    expect(body.status).toBe("processing");
    await registryQueue.onIdle();
  });

  it("returns batch_id for valid CSV (enterprise tier)", async () => {
    const { rawKey } = createTestKey("enterprise");
    const res = await app.request("/v1/batch/csv", {
      method: "POST",
      headers: { Authorization: `Bearer ${rawKey}`, "Content-Type": "text/csv" },
      body: VALID_CSV,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.batch_id).toBeDefined();
    await registryQueue.onIdle();
  });

  it("returns 403 for free tier", async () => {
    const { rawKey } = createTestKey("free");
    const res = await app.request("/v1/batch/csv", {
      method: "POST",
      headers: { Authorization: `Bearer ${rawKey}`, "Content-Type": "text/csv" },
      body: VALID_CSV,
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    const err = body.error as Record<string, unknown>;
    expect(err.code).toBe("FORBIDDEN");
  });

  it("returns 403 for pro tier", async () => {
    const { rawKey } = createTestKey("pro");
    const res = await app.request("/v1/batch/csv", {
      method: "POST",
      headers: { Authorization: `Bearer ${rawKey}`, "Content-Type": "text/csv" },
      body: VALID_CSV,
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    const err = body.error as Record<string, unknown>;
    expect(err.code).toBe("FORBIDDEN");
  });

  it("returns 400 for wrong Content-Type", async () => {
    const { rawKey } = createTestKey("business");
    const res = await app.request("/v1/batch/csv", {
      method: "POST",
      headers: { Authorization: `Bearer ${rawKey}`, "Content-Type": "application/json" },
      body: VALID_CSV,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    const err = body.error as Record<string, unknown>;
    expect(err.code).toBe("BAD_REQUEST");
  });

  it("returns 422 for CSV with header only (no data rows)", async () => {
    const { rawKey } = createTestKey("business");
    const res = await app.request("/v1/batch/csv", {
      method: "POST",
      headers: { Authorization: `Bearer ${rawKey}`, "Content-Type": "text/csv" },
      body: CSV_HEADER,
    });
    expect(res.status).toBe(422);
  });

  it("returns 422 for more than 100 data rows", async () => {
    const { rawKey } = createTestKey("business");
    const rows = Array.from({ length: 101 }, (_, i) => `cust-${i},12-3456789,US,EIN`).join("\n");
    const res = await app.request("/v1/batch/csv", {
      method: "POST",
      headers: { Authorization: `Bearer ${rawKey}`, "Content-Type": "text/csv" },
      body: `${CSV_HEADER}\n${rows}`,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as Record<string, unknown>;
    const err = body.error as Record<string, unknown>;
    expect(err.code).toBe("VALIDATION_ERROR");
  });

  it("returns 422 for row with invalid type", async () => {
    const { rawKey } = createTestKey("business");
    const res = await app.request("/v1/batch/csv", {
      method: "POST",
      headers: { Authorization: `Bearer ${rawKey}`, "Content-Type": "text/csv" },
      body: `${CSV_HEADER}\ncust-1,12-3456789,US,INVALID`,
    });
    expect(res.status).toBe(422);
  });

  it("returns 422 for row with country length != 2", async () => {
    const { rawKey } = createTestKey("business");
    const res = await app.request("/v1/batch/csv", {
      method: "POST",
      headers: { Authorization: `Bearer ${rawKey}`, "Content-Type": "text/csv" },
      body: `${CSV_HEADER}\ncust-1,12-3456789,USA,EIN`,
    });
    expect(res.status).toBe(422);
  });

  it("GET /v1/batch/:id returns completed results after CSV batch", async () => {
    const { rawKey } = createTestKey("business");
    const submit = await app.request("/v1/batch/csv", {
      method: "POST",
      headers: { Authorization: `Bearer ${rawKey}`, "Content-Type": "text/csv" },
      body: `${CSV_HEADER}\ncust-a,12-3456789,US,EIN`,
    });
    expect(submit.status).toBe(200);
    const { batch_id } = (await submit.json()) as { batch_id: string };

    await registryQueue.onIdle();

    const res = await app.request(`/v1/batch/${batch_id}`, {
      method: "GET",
      headers: authHeader(rawKey),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.batch_id).toBe(batch_id);
    expect(body.status).toBe("complete");
    const results = body.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect(results[0].ref).toBe("cust-a");
  });
});
