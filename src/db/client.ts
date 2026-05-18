import Database from "better-sqlite3";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

let _db: Database.Database | null = null;
let _dbPath: string | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return _db;
}

export function initDb(dbPath?: string): Database.Database {
  const resolvedPath =
    dbPath ?? process.env.DATABASE_PATH ?? join(__dirname, "../../data/taxidverify.db");
  if (resolvedPath !== ":memory:") {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }
  _dbPath = resolvedPath;
  _db = new Database(resolvedPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  runMigrations(_db);
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
    _dbPath = null;
  }
}

export function getDbPath(): string | null {
  return _dbPath;
}

function runMigrations(db: Database.Database): void {
  // M1: Remove restrictive tier CHECK constraint and add billing_cycle column.
  // Detect the old schema by checking for the original 3-value CHECK.
  const apiKeysRow = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='api_keys'")
    .get() as { sql: string } | undefined;

  if (apiKeysRow?.sql.includes("'free','pro','enterprise'")) {
    // Ensure stripe columns exist in old table before copying data
    for (const col of ["stripe_customer_id", "stripe_subscription_id"]) {
      try {
        db.exec(`ALTER TABLE api_keys ADD COLUMN ${col} TEXT`);
      } catch { /* already exists */ }
    }

    // Recreate the table without the restrictive CHECK and with billing_cycle
    db.exec(`
      CREATE TABLE api_keys_new (
        key_id TEXT PRIMARY KEY,
        key_hash TEXT UNIQUE NOT NULL,
        tier TEXT NOT NULL,
        daily_limit INTEGER NOT NULL,
        daily_used INTEGER NOT NULL DEFAULT 0,
        reset_at TEXT NOT NULL,
        webhook_secret TEXT,
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        billing_cycle TEXT NOT NULL DEFAULT 'monthly',
        created_at TEXT NOT NULL
      )
    `);
    db.exec(`
      INSERT INTO api_keys_new
        (key_id, key_hash, tier, daily_limit, daily_used, reset_at,
         webhook_secret, stripe_customer_id, stripe_subscription_id, billing_cycle, created_at)
      SELECT
        key_id, key_hash, tier, daily_limit, daily_used, reset_at,
        webhook_secret, stripe_customer_id, stripe_subscription_id, 'monthly', created_at
      FROM api_keys
    `);
    db.exec("DROP TABLE api_keys");
    db.exec("ALTER TABLE api_keys_new RENAME TO api_keys");
  }

  // Create all tables (no-op if they already exist after migration above)
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      key_id TEXT PRIMARY KEY,
      key_hash TEXT UNIQUE NOT NULL,
      tier TEXT NOT NULL,
      daily_limit INTEGER NOT NULL,
      daily_used INTEGER NOT NULL DEFAULT 0,
      overage_used INTEGER NOT NULL DEFAULT 0,
      reset_at TEXT NOT NULL,
      webhook_secret TEXT,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      billing_cycle TEXT NOT NULL DEFAULT 'monthly',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS validation_jobs (
      job_id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK(status IN ('pending','processing','complete','failed')),
      valid INTEGER NOT NULL DEFAULT 0,
      tax_id TEXT NOT NULL,
      country TEXT NOT NULL,
      type TEXT NOT NULL,
      format_normalized TEXT NOT NULL,
      registered INTEGER,
      business_name TEXT,
      registered_address TEXT,
      registration_date TEXT,
      fraud_risk_score INTEGER NOT NULL DEFAULT 0,
      data_source TEXT,
      error TEXT,
      webhook_url TEXT,
      webhook_secret TEXT,
      checked_at TEXT NOT NULL,
      api_key_id TEXT NOT NULL,
      FOREIGN KEY (api_key_id) REFERENCES api_keys(key_id)
    );

    CREATE TABLE IF NOT EXISTS batch_jobs (
      batch_id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK(status IN ('pending','processing','complete','failed')),
      count INTEGER NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      webhook_url TEXT,
      created_at TEXT NOT NULL,
      api_key_id TEXT NOT NULL,
      FOREIGN KEY (api_key_id) REFERENCES api_keys(key_id)
    );

    CREATE TABLE IF NOT EXISTS batch_items (
      item_id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      ref TEXT NOT NULL,
      job_id TEXT,
      FOREIGN KEY (batch_id) REFERENCES batch_jobs(batch_id),
      FOREIGN KEY (job_id) REFERENCES validation_jobs(job_id)
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      rl_key TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (rl_key, window_start)
    );

    CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
    CREATE INDEX IF NOT EXISTS idx_jobs_api_key ON validation_jobs(api_key_id);
    CREATE INDEX IF NOT EXISTS idx_batch_items_batch ON batch_items(batch_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_checked_at ON validation_jobs(api_key_id, checked_at);
  `);

  // Idempotent column additions for databases that predate these columns
  for (const [col, def] of [
    ["stripe_customer_id", "TEXT"],
    ["stripe_subscription_id", "TEXT"],
    ["billing_cycle", "TEXT NOT NULL DEFAULT 'monthly'"],
    ["alert_threshold", "INTEGER"],
    ["alert_webhook_url", "TEXT"],
    ["overage_used", "INTEGER NOT NULL DEFAULT 0"],
  ] as Array<[string, string]>) {
    try {
      db.exec(`ALTER TABLE api_keys ADD COLUMN ${col} ${def}`);
    } catch { /* already exists */ }
  }

  try {
    db.exec("ALTER TABLE validation_jobs ADD COLUMN data_source TEXT");
  } catch { /* already exists */ }
}
