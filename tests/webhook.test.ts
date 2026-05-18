import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("../src/utils/ssrf.js", () => ({
  validateWebhookUrl: vi.fn().mockResolvedValue(undefined),
  SSRFError: class SSRFError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "SSRFError";
    }
  },
}));

import { deliverWebhook } from "../src/services/webhook.js";
import { validateWebhookUrl } from "../src/utils/ssrf.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  vi.mocked(validateWebhookUrl).mockResolvedValue(undefined);
  mockFetch.mockResolvedValue({ ok: true, status: 200 });
});

describe("deliverWebhook — HMAC signature", () => {
  it("attaches X-TaxIDVerify-Signature with correct sha256 HMAC when secret provided", async () => {
    const secret = "my-webhook-secret";
    const payload = { event: "verified", tax_id: "12-3456789" };

    await deliverWebhook("https://example.com/hook", payload, secret);

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = options.body as string;
    const headers = options.headers as Record<string, string>;

    const expectedSig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
    expect(headers["X-TaxIDVerify-Signature"]).toBe(expectedSig);
  });

  it("signature can be independently verified using the same secret and raw body", async () => {
    const secret = "signing-key-xyz";
    const payload = { job_id: "abc-123", status: "complete", fraud_risk_score: 5 };

    await deliverWebhook("https://hooks.example.com/cb", payload, secret);

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const sentBody = options.body as string;
    const sentSig = (options.headers as Record<string, string>)["X-TaxIDVerify-Signature"];

    const recomputed = "sha256=" + createHmac("sha256", secret).update(sentBody).digest("hex");
    expect(sentSig).toBe(recomputed);
    expect(JSON.parse(sentBody)).toEqual(payload);
  });

  it("omits X-TaxIDVerify-Signature when no secret argument is passed", async () => {
    await deliverWebhook("https://example.com/hook", { event: "test" });

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;
    expect(headers["X-TaxIDVerify-Signature"]).toBeUndefined();
  });

  it("omits X-TaxIDVerify-Signature when secret is null", async () => {
    await deliverWebhook("https://example.com/hook", { event: "test" }, null);

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;
    expect(headers["X-TaxIDVerify-Signature"]).toBeUndefined();
  });
});

describe("deliverWebhook — request format", () => {
  it("sends POST with JSON body and Content-Type header", async () => {
    const payload = { score: 42, id: "test" };
    await deliverWebhook("https://hooks.example.com/endpoint", payload);

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.example.com/endpoint");
    expect(options.method).toBe("POST");
    expect((options.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(options.body).toBe(JSON.stringify(payload));
  });

  it("does not call fetch when SSRF check rejects the URL", async () => {
    vi.mocked(validateWebhookUrl).mockRejectedValueOnce(
      new Error("URL must not point to a private or reserved IP address"),
    );

    await deliverWebhook("http://192.168.1.1/hook", { event: "test" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("retries up to 3 times on non-2xx response", async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    const promise = deliverWebhook("https://example.com/hook", { event: "test" });
    await vi.runAllTimersAsync();
    await promise;

    expect(mockFetch).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
