# TaxIDVerify

Real-time validation and enrichment of business tax IDs (EIN, VAT, GST, ABN, GSTIN) across 40+ countries with built-in fraud risk scoring.

Built with **Hono + TypeScript + SQLite** for a tiny, fast, production-ready footprint.

## Features

- Sync format validation (`POST /v1/validate`) — instant pass/fail with fraud score
- Async registry verification (`POST /v1/verify`) — looks up business name, address, registration date
- Batch verification (`POST /v1/batch`) — up to 100 IDs per request (JSON)
- Bulk CSV upload (`POST /v1/batch/csv`) — Business tier and above
- Priority verification queue — Business and Enterprise requests are processed ahead of Pro
- Webhook callbacks with HMAC-SHA256 signatures
- Overage billing at $0.02/call — paid subscribers are never hard-blocked when over quota
- Per-key daily rate limits with automatic reset

## Who This Is For

TaxIDVerify is purpose-built for:

- **Fintech KYB platforms** — automate business identity verification during onboarding
- **EU VAT compliance tools** — validate and enrich EU VAT numbers against VIES in real time
- **Marketplace seller verification services** — screen sellers at registration and on a recurring basis

## Pricing Tiers

| Feature | Free | Pro | Business | Enterprise |
|---|---|---|---|---|
| **Price (monthly)** | **free** | **$29/mo** | **$99/mo** | **$499/mo** |
| `/v1/validate` (format check) | ✓ | ✓ | ✓ | ✓ |
| `/v1/verify` (registry lookup) | — | ✓ | ✓ | ✓ |
| `/v1/batch` (JSON bulk, up to 100) | — | ✓ | ✓ | ✓ |
| `/v1/batch/csv` (CSV upload) | — | — | ✓ | ✓ |
| Daily request limit | 50 | 1,000 | 5,000 | 50,000 |
| Webhook delivery | — | ✓ | ✓ | ✓ |
| Usage alerts (`/v1/usage/alert`) | ✓ | ✓ | ✓ | ✓ |
| Priority verification queue | — | — | ✓ | ✓ |
| Dedicated support | — | — | — | ✓ |
| Custom SLA | — | — | — | ✓ |

**Annual pricing:** 20% discount applied automatically when `billing_cycle: "annual"`.

**Overage billing:** Paid subscribers who exceed their daily limit are billed at **$0.02/call** rather than hard-blocked. The response includes an `X-Overage-Charge: 0.02` header. Free keys receive a `429` instead.

Upgrade your tier at any time via `POST /v1/checkout`.

## Quick Start

```bash
npm install
npm run dev     # dev mode, watches src/
# or
npm run build && npm start
```

The server listens on `PORT` (default `3000`).

## SDK Examples

### curl

```bash
# Register a free API key
curl -X POST http://localhost:3000/v1/keys \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com"}'

# Format-validate a US EIN
curl -X POST http://localhost:3000/v1/validate \
  -H "Authorization: Bearer <api_key>" \
  -H "Content-Type: application/json" \
  -d '{"id":"12-3456789","country":"US","type":"EIN"}'

# Async registry verification (Pro+)
curl -X POST http://localhost:3000/v1/verify \
  -H "Authorization: Bearer <api_key>" \
  -H "Content-Type: application/json" \
  -d '{"id":"DE123456789","country":"DE","type":"VAT","webhook_url":"https://your-app.example.com/webhooks/taxid"}'

# Bulk CSV upload (Business+)
curl -X POST http://localhost:3000/v1/batch/csv \
  -H "Authorization: Bearer <api_key>" \
  -H "Content-Type: text/csv" \
  --data-binary $'ref,id,country,type\ncust-1,12-3456789,US,EIN\ncust-2,DE123456789,DE,VAT'
```

### Python

```python
import requests

BASE_URL = "http://localhost:3000"
API_KEY = "<your_api_key>"
HEADERS = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}

# Format validate
resp = requests.post(f"{BASE_URL}/v1/validate", headers=HEADERS,
    json={"id": "12-3456789", "country": "US", "type": "EIN"})
print(resp.json())

# Async registry lookup
resp = requests.post(f"{BASE_URL}/v1/verify", headers=HEADERS,
    json={"id": "DE123456789", "country": "DE", "type": "VAT"})
job = resp.json()
print(f"Job started: {job['job_id']}")

# Poll for result
import time
while True:
    result = requests.get(f"{BASE_URL}/v1/verify/{job['job_id']}", headers=HEADERS).json()
    if result["status"] in ("complete", "failed"):
        print(result)
        break
    time.sleep(0.5)
```

### JavaScript / TypeScript

```typescript
const BASE_URL = "http://localhost:3000";
const API_KEY = "<your_api_key>";
const headers = { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" };

// Format validate
const validation = await fetch(`${BASE_URL}/v1/validate`, {
  method: "POST",
  headers,
  body: JSON.stringify({ id: "12-3456789", country: "US", type: "EIN" }),
}).then((r) => r.json());

// Batch verification
const batch = await fetch(`${BASE_URL}/v1/batch`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    items: [
      { ref: "cust-1", id: "12-3456789", country: "US", type: "EIN" },
      { ref: "cust-2", id: "DE123456789", country: "DE", type: "VAT" },
    ],
    webhook_url: "https://your-app.example.com/webhooks/batch",
  }),
}).then((r) => r.json());

// Check usage (includes upgrade_prompt when near quota)
const usage = await fetch(`${BASE_URL}/v1/usage`, { headers }).then((r) => r.json());
if (usage.upgrade_prompt) console.warn(usage.upgrade_prompt);
```

## Authentication

All `/v1/validate`, `/v1/verify`, and `/v1/batch` endpoints require a bearer token:

```
Authorization: Bearer <api_key>
```

Get a key:

```bash
curl -X POST http://localhost:3000/v1/keys \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com"}'
```

The response contains the `api_key` once — store it immediately. The DB only keeps a SHA-256 hash.

## API Reference

See [`docs/api-reference.md`](docs/api-reference.md) for full endpoint documentation.

### Quick reference

| Method | Path | Auth | Tier |
|---|---|---|---|
| `POST` | `/v1/keys` | — | free |
| `POST` | `/v1/validate` | ✓ | all |
| `POST` | `/v1/verify` | ✓ | Pro+ |
| `GET` | `/v1/verify/:job_id` | ✓ | Pro+ |
| `POST` | `/v1/batch` | ✓ | Pro+ |
| `GET` | `/v1/batch/:batch_id` | ✓ | Pro+ |
| `POST` | `/v1/batch/csv` | ✓ | Business+ |
| `POST` | `/v1/checkout` | ✓ | — |
| `GET` | `/v1/usage` | ✓ | all |
| `POST` | `/v1/usage/alert` | ✓ | all |
| `GET` | `/health` | — | — |

## Webhook Signatures

Every webhook delivery includes an `X-TaxIDVerify-Signature: sha256=<hex>` header.

Verify it in your handler:

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

function verifySignature(body: string, header: string, secret: string): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

## Simulated Registry Data

> **Important:** For EU VAT numbers, `/v1/verify` queries the live **VIES SOAP service** (when `VIES_ENABLED=true`). For all other countries — US EIN, AU ABN, CA GST, IN GSTIN — the registry enrichment response is **simulated**: business name, address, and registration date are synthetic and not sourced from official registries. Simulated responses include `"data_source": "simulated"` in the JSON body so callers can distinguish them from real VIES data.

### Roadmap

Real official-registry integrations are planned for Q3 2026:

- **IRS TIN Matching** (US EIN) — batch TIN matching via IRS e-Services
- **ABR ABN Lookup** (AU) — Australian Business Register open API
- **GSTIN Verification** (IN) — GST Common Portal public API

## Docker

```bash
docker build -t taxidverify .
docker run -p 3000:3000 -v $(pwd)/data:/app/data taxidverify
```

The SQLite database lives at `/app/data/taxidverify.db` inside the container — mount a volume to persist it.

## Environment Variables

Copy `.env.example` to `.env` and fill in your values.

### Server

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP listen port |
| `LOG_LEVEL` | `info` | Pino log level (`trace` \| `debug` \| `info` \| `warn` \| `error`) |
| `DATABASE_PATH` | `./data/taxidverify.db` | SQLite file path; use `:memory:` for ephemeral/test runs |

### Stripe (payments)

| Variable | Default | Description |
|---|---|---|
| `STRIPE_SECRET_KEY` | — | Stripe secret key (`sk_live_...` or `sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | — | Stripe webhook signing secret (`whsec_...`) |
| `STRIPE_PRICE_PRO` | — | Stripe Price ID for **Pro** ($29/mo) monthly |
| `STRIPE_PRICE_BUSINESS` | — | Stripe Price ID for **Business** ($99/mo) monthly |
| `STRIPE_PRICE_ENTERPRISE` | — | Stripe Price ID for **Enterprise** ($499/mo) monthly |
| `STRIPE_PRICE_PRO_ANNUAL` | — | Stripe Price ID for Pro annual |
| `STRIPE_PRICE_BUSINESS_ANNUAL` | — | Stripe Price ID for Business annual |
| `STRIPE_PRICE_ENTERPRISE_ANNUAL` | — | Stripe Price ID for Enterprise annual |

### Registry lookup

| Variable | Default | Description |
|---|---|---|
| `VIES_ENABLED` | `true` | Set `false` to skip real VIES SOAP calls and use simulation |
| `REGISTRY_MIN_DELAY` | `100` | Simulated registry min latency ms (ignored when VIES active) |
| `REGISTRY_MAX_DELAY` | `900` | Simulated registry max latency ms (ignored when VIES active) |

## Development

```bash
npm test         # run vitest once
npm run test:watch
npm run lint
npm run typecheck
npm run build    # → dist/
```

## License

MIT
