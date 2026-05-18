import { createHmac } from "node:crypto";
import pino from "pino";
import { validateWebhookUrl, SSRFError } from "../utils/ssrf.js";

const logger = pino({ name: "webhook" });

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 5000, 30000]; // 1s, 5s, 30s

export async function deliverWebhook(
  url: string,
  payload: unknown,
  secret?: string | null,
): Promise<void> {
  // Re-validate the URL right before delivery to guard against DNS rebinding
  // and to ensure no bypass path exists.
  try {
    await validateWebhookUrl(url);
  } catch (err) {
    const msg = err instanceof SSRFError ? err.message : String(err);
    logger.error({ url, reason: msg }, "SSRF check blocked webhook delivery");
    return;
  }

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "TaxIDVerify-Webhook/1.0",
  };

  if (secret) {
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    headers["X-TaxIDVerify-Signature"] = `sha256=${sig}`;
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { method: "POST", headers, body });
      if (res.ok) {
        logger.info({ url, attempt }, "Webhook delivered");
        return;
      }
      logger.warn({ url, attempt, status: res.status }, "Webhook non-2xx response");
    } catch (err) {
      logger.warn({ url, attempt, err }, "Webhook delivery error");
    }

    if (attempt < MAX_RETRIES - 1) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
    }
  }
  logger.error({ url }, "Webhook delivery failed after all retries");
}
