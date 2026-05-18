# TaxIDVerify API Reference

Base URL: `http://localhost:3000` (or your deployed domain)

All authenticated endpoints require:
```
Authorization: Bearer <api_key>
Content-Type: application/json
```

---

## POST /v1/keys

Register a new API key (free tier). No authentication required.

**Rate limit:** 10 registrations per IP per hour.

### Request

```json
{ "email": "you@example.com" }
```

### Response `201`

```json
{
  "api_key": "<64-char hex string>",
  "key_id": "<uuid>",
  "tier": "free",
  "daily_limit": 50,
  "webhook_secret": "<48-char hex string>",
  "message": "Store this API key securely — it will not be shown again."
}
```

The raw `api_key` is shown **once only**. The database stores only the SHA-256 hash.

---

## POST /v1/validate

Synchronous format-only validation. Available on all tiers.

### Request

```json
{
  "id": "12-3456789",
  "country": "US",
  "type": "EIN"
}
```

| Field | Type | Description |
|---|---|---|
| `id` | string | The tax ID to validate (max 200 chars) |
| `country` | string | ISO 3166-1 alpha-2 country code |
| `type` | string | `EIN` \| `VAT` \| `GST` \| `ABN` \| `GSTIN` |

### Response `200`

```json
{
  "valid": true,
  "id": "12-3456789",
  "country": "US",
  "type": "EIN",
  "format_normalized": "12-3456789",
  "fraud_risk_score": 0,
  "checked_at": "2026-05-18T10:00:00.000Z"
}
```

`fraud_risk_score` is 0–100. Higher values indicate higher risk.

---

## POST /v1/verify

Kick off an async registry lookup. **Pro tier and above.**

### Request

```json
{
  "id": "DE123456789",
  "country": "DE",
  "type": "VAT",
  "webhook_url": "https://your-app.example.com/webhooks/taxid"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Tax ID to verify |
| `country` | string | ✓ | ISO alpha-2 country code |
| `type` | string | ✓ | `EIN` \| `VAT` \| `GST` \| `ABN` \| `GSTIN` |
| `webhook_url` | string | — | HTTPS URL to POST results when complete |

### Response `200`

```json
{
  "job_id": "<uuid>",
  "status": "pending",
  "valid": true,
  "fraud_risk_score": 5,
  "checked_at": "2026-05-18T10:00:00.000Z"
}
```

Poll `GET /v1/verify/:job_id` for results, or use `webhook_url` to receive a push notification.

> **Simulated data note:** EU VAT lookups use the live VIES SOAP service. US EIN, AU ABN, CA GST, and IN GSTIN lookups return **simulated** enrichment data. Real IRS TIN matching, ABR ABN lookup, and GSTIN verification are planned for Q3 2026.

> **Priority queue:** Business and Enterprise keys are processed ahead of Pro keys in the verification queue.

---

## GET /v1/verify/:job_id

Fetch the current state of a verification job.

### Response `200`

```json
{
  "job_id": "<uuid>",
  "status": "complete",
  "valid": true,
  "id": "DE123456789",
  "country": "DE",
  "type": "VAT",
  "format_normalized": "DE123456789",
  "registered": true,
  "business_name": "Example GmbH",
  "registered_address": "Musterstraße 1, 10115 Berlin, DE",
  "registration_date": "2010-03-15",
  "fraud_risk_score": 2,
  "checked_at": "2026-05-18T10:00:00.000Z"
}
```

`status` values: `pending` | `processing` | `complete` | `failed`

---

## POST /v1/batch

Submit up to 100 tax IDs for async batch verification. **Pro tier and above.**

### Request

```json
{
  "items": [
    { "ref": "customer-1", "id": "12-3456789", "country": "US", "type": "EIN" },
    { "ref": "customer-2", "id": "DE123456789", "country": "DE", "type": "VAT" }
  ],
  "webhook_url": "https://your-app.example.com/webhooks/batch"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `items` | array | ✓ | 1–100 items |
| `items[].ref` | string | ✓ | Your reference ID for this item (max 100 chars) |
| `items[].id` | string | ✓ | Tax ID to verify |
| `items[].country` | string | ✓ | ISO alpha-2 country code |
| `items[].type` | string | ✓ | `EIN` \| `VAT` \| `GST` \| `ABN` \| `GSTIN` |
| `webhook_url` | string | — | HTTPS URL to POST when all items are complete |

### Response `200`

```json
{ "batch_id": "<uuid>", "count": 2, "status": "processing" }
```

---

## POST /v1/batch/csv

Upload a CSV file for bulk batch verification. **Business tier and above.**

### Request

```
Content-Type: text/csv
```

CSV format — first row must be the header `ref,id,country,type`:

```
ref,id,country,type
customer-1,12-3456789,US,EIN
customer-2,DE123456789,DE,VAT
customer-3,51824753556,AU,ABN
```

Maximum 100 data rows per upload.

### Response `200`

```json
{ "batch_id": "<uuid>", "count": 3, "status": "processing" }
```

---

## GET /v1/batch/:batch_id

Fetch batch status and all item results.

### Response `200`

```json
{
  "batch_id": "<uuid>",
  "status": "complete",
  "count": 2,
  "completed": 2,
  "created_at": "2026-05-18T10:00:00.000Z",
  "results": [
    {
      "ref": "customer-1",
      "valid": true,
      "fraud_risk_score": 0,
      "registered": true,
      "business_name": "Acme Corp"
    },
    {
      "ref": "customer-2",
      "valid": true,
      "fraud_risk_score": 5,
      "registered": true,
      "business_name": "Example GmbH"
    }
  ]
}
```

---

## POST /v1/checkout

Create a Stripe checkout session to upgrade your tier.

### Request

```json
{
  "tier": "pro",
  "billing_cycle": "monthly",
  "success_url": "https://your-app.example.com/success",
  "cancel_url": "https://your-app.example.com/cancel"
}
```

| Field | Type | Values |
|---|---|---|
| `tier` | string | `pro` \| `business` \| `enterprise` |
| `billing_cycle` | string | `monthly` \| `annual` |
| `success_url` | string | Redirect after successful payment |
| `cancel_url` | string | Redirect if user cancels |

### Response `200`

```json
{
  "checkout_url": "https://checkout.stripe.com/...",
  "tier": "pro",
  "billing_cycle": "monthly"
}
```

Redirect the user to `checkout_url` to complete payment.

---

## GET /v1/usage

View your daily usage, quota, and 30-day history.

### Response `200`

```json
{
  "daily_used": 842,
  "daily_limit": 1000,
  "overage_used": 0,
  "reset_at": "2026-05-19T00:00:00.000Z",
  "tier": "pro",
  "billing_cycle": "monthly",
  "upgrade_prompt": "You've used 84% of your daily quota. Consider upgrading at /v1/checkout",
  "history": [
    { "date": "2026-05-18", "count": 842 },
    { "date": "2026-05-17", "count": 1000 }
  ]
}
```

`upgrade_prompt` is included when `daily_used / daily_limit >= 0.80`. It becomes more urgent at 90%+.

`overage_used` tracks calls served beyond the daily limit (billed at $0.02/call for paid subscribers).

---

## POST /v1/usage/alert

Configure a webhook to fire when daily usage crosses a threshold.

### Request

```json
{
  "threshold_percent": 80,
  "webhook_url": "https://your-app.example.com/webhooks/usage-alert"
}
```

| Field | Type | Description |
|---|---|---|
| `threshold_percent` | integer | 50–90. Alert fires when this % of daily quota is reached |
| `webhook_url` | string | HTTPS URL to POST when threshold is crossed |

### Response `200`

```json
{
  "threshold_percent": 80,
  "webhook_url": "https://your-app.example.com/webhooks/usage-alert",
  "message": "Usage alert configured. A webhook notification will fire when daily usage crosses this threshold."
}
```

---

## GET /health

Liveness and database connectivity check. No authentication required.

### Response `200`

```json
{
  "status": "ok",
  "uptime_seconds": 1234,
  "db": "connected",
  "timestamp": "2026-05-18T10:00:00.000Z"
}
```

---

## Error Responses

All errors follow this shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description",
    "details": [{ "field": "country", "message": "String must contain exactly 2 character(s)" }]
  }
}
```

| HTTP Status | Code | Meaning |
|---|---|---|
| 400 | `BAD_REQUEST` | Malformed JSON or missing required header |
| 401 | `UNAUTHORIZED` | Missing or invalid API key |
| 403 | `FORBIDDEN` | Feature not available on your current tier |
| 404 | `NOT_FOUND` | Job or batch not found |
| 422 | `VALIDATION_ERROR` | Input failed schema validation |
| 429 | `RATE_LIMIT_EXCEEDED` | Daily quota exceeded (free tier) |
| 503 | `SERVICE_UNAVAILABLE` | Stripe not configured (checkout only) |

---

## Rate Limiting Headers

| Header | Description |
|---|---|
| `Retry-After` | Seconds until daily quota resets (on `429` for free tier) |
| `X-Usage-Warning` | Sent when ≥80% of daily quota is consumed |
| `X-Overage-Charge` | Value `0.02` — present when a paid subscriber is being billed for an overage call |
