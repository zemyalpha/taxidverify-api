import { beforeAll, afterAll, beforeEach } from "vitest";
import { initDb, closeDb, getDb } from "../src/db/client.js";

beforeAll(() => {
  // Speed up / stub out external calls in tests
  process.env.REGISTRY_MIN_DELAY = "0";
  process.env.REGISTRY_MAX_DELAY = "0";
  process.env.VIES_ENABLED = "false"; // skip real VIES SOAP calls in CI
  initDb(":memory:");
});

afterAll(() => {
  closeDb();
});

beforeEach(() => {
  const db = getDb();
  // Clean tables between tests
  db.exec(`
    DELETE FROM batch_items;
    DELETE FROM batch_jobs;
    DELETE FROM validation_jobs;
    DELETE FROM api_keys;
    DELETE FROM rate_limits;
  `);
});
