import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateWebhookUrl, SSRFError } from "../src/utils/ssrf.js";

// Mock node:dns/promises so tests never make real DNS lookups
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

import { lookup } from "node:dns/promises";
const mockLookup = vi.mocked(lookup);

// Helper to prime the mock with a set of resolved addresses
function mockDns(addresses: { address: string; family: number }[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockLookup.mockResolvedValue(addresses as any);
}

beforeEach(() => {
  mockLookup.mockReset();
  // Default: resolve to a safe public address so tests that don't
  // care about DNS still work unless they override this.
  mockDns([{ address: "93.184.216.34", family: 4 }]);
});

describe("validateWebhookUrl — blocked hostnames", () => {
  it("blocks localhost", async () => {
    await expect(validateWebhookUrl("http://localhost/hook")).rejects.toThrow(SSRFError);
  });

  it("blocks GCP metadata endpoint by hostname", async () => {
    await expect(
      validateWebhookUrl("http://metadata.google.internal/computeMetadata/v1/"),
    ).rejects.toThrow(SSRFError);
  });

  it("blocks 169.254.169.254 as hostname (AWS metadata)", async () => {
    await expect(validateWebhookUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      SSRFError,
    );
  });
});

describe("validateWebhookUrl — private IP addresses in URL", () => {
  it("blocks 10.x.x.x (RFC-1918)", async () => {
    await expect(validateWebhookUrl("http://10.0.0.1/hook")).rejects.toThrow(SSRFError);
  });

  it("blocks 192.168.x.x (RFC-1918)", async () => {
    await expect(validateWebhookUrl("https://192.168.1.100/hook")).rejects.toThrow(SSRFError);
  });

  it("blocks 172.16.x.x (RFC-1918)", async () => {
    await expect(validateWebhookUrl("https://172.16.0.1/hook")).rejects.toThrow(SSRFError);
  });

  it("blocks 127.0.0.1 (loopback)", async () => {
    await expect(validateWebhookUrl("http://127.0.0.1:8080/hook")).rejects.toThrow(SSRFError);
  });

  it("blocks 169.254.x.x (link-local / cloud metadata)", async () => {
    await expect(validateWebhookUrl("http://169.254.0.1/hook")).rejects.toThrow(SSRFError);
  });

  it("blocks ::1 (IPv6 loopback)", async () => {
    await expect(validateWebhookUrl("http://[::1]/hook")).rejects.toThrow(SSRFError);
  });
});

describe("validateWebhookUrl — DNS resolution checks", () => {
  it("blocks a hostname that resolves to a private IP", async () => {
    mockDns([{ address: "192.168.1.50", family: 4 }]);
    await expect(validateWebhookUrl("https://internal.corp.example/hook")).rejects.toThrow(
      SSRFError,
    );
  });

  it("blocks when DNS resolution fails", async () => {
    mockLookup.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(validateWebhookUrl("https://nonexistent.invalid/hook")).rejects.toThrow(SSRFError);
  });

  it("allows a hostname that resolves to a public IP", async () => {
    mockDns([{ address: "93.184.216.34", family: 4 }]);
    await expect(validateWebhookUrl("https://example.com/hook")).resolves.toBeUndefined();
  });
});

describe("validateWebhookUrl — protocol checks", () => {
  it("allows https:// URLs", async () => {
    await expect(validateWebhookUrl("https://example.com/hook")).resolves.toBeUndefined();
  });

  it("allows http:// URLs", async () => {
    await expect(validateWebhookUrl("http://example.com/hook")).resolves.toBeUndefined();
  });

  it("rejects ftp:// protocol", async () => {
    await expect(validateWebhookUrl("ftp://example.com/hook")).rejects.toThrow(SSRFError);
  });

  it("rejects file:// protocol", async () => {
    await expect(validateWebhookUrl("file:///etc/passwd")).rejects.toThrow(SSRFError);
  });

  it("rejects malformed URL", async () => {
    await expect(validateWebhookUrl("not a url")).rejects.toThrow(SSRFError);
  });
});

describe("validateWebhookUrl — IPv6 private addresses", () => {
  it("blocks fe80::1 (IPv6 link-local)", async () => {
    await expect(validateWebhookUrl("http://[fe80::1]/hook")).rejects.toThrow(SSRFError);
  });

  it("blocks fd00::1 (IPv6 unique-local fd::/8)", async () => {
    await expect(validateWebhookUrl("http://[fd00::1]/hook")).rejects.toThrow(SSRFError);
  });

  it("blocks fc00::1 (IPv6 unique-local fc::/8)", async () => {
    await expect(validateWebhookUrl("http://[fc00::1]/hook")).rejects.toThrow(SSRFError);
  });
});

describe("validateWebhookUrl — CGNAT range (100.64.0.0/10)", () => {
  it("blocks 100.64.0.1 (CGNAT lower boundary)", async () => {
    await expect(validateWebhookUrl("http://100.64.0.1/hook")).rejects.toThrow(SSRFError);
  });

  it("blocks 100.127.255.255 (CGNAT upper boundary)", async () => {
    await expect(validateWebhookUrl("http://100.127.255.255/hook")).rejects.toThrow(SSRFError);
  });

  it("allows 100.128.0.1 (just outside CGNAT range)", async () => {
    await expect(validateWebhookUrl("http://100.128.0.1/hook")).resolves.toBeUndefined();
  });

  it("blocks hostname resolving to a CGNAT address", async () => {
    mockDns([{ address: "100.100.100.100", family: 4 }]);
    await expect(validateWebhookUrl("https://cgnat.example.com/hook")).rejects.toThrow(SSRFError);
  });
});

describe("validateWebhookUrl — cloud metadata IP via DNS resolution", () => {
  it("blocks hostname resolving to 169.254.169.254 (AWS/GCP metadata)", async () => {
    mockDns([{ address: "169.254.169.254", family: 4 }]);
    await expect(validateWebhookUrl("https://metadata.example.com/hook")).rejects.toThrow(SSRFError);
  });
});

describe("validateWebhookUrl — localhost and zero-network variations", () => {
  it("blocks 0.0.0.0 ('this' network)", async () => {
    await expect(validateWebhookUrl("http://0.0.0.0/hook")).rejects.toThrow(SSRFError);
  });

  it("blocks 127.0.0.2 (still within 127.0.0.0/8 loopback range)", async () => {
    await expect(validateWebhookUrl("http://127.0.0.2/hook")).rejects.toThrow(SSRFError);
  });

  it("blocks 127.127.127.127 (loopback range)", async () => {
    await expect(validateWebhookUrl("http://127.127.127.127/hook")).rejects.toThrow(SSRFError);
  });
});

describe("validateWebhookUrl — RFC-1918 boundary checks", () => {
  it("blocks 172.31.255.255 (RFC-1918 class B upper boundary)", async () => {
    await expect(validateWebhookUrl("http://172.31.255.255/hook")).rejects.toThrow(SSRFError);
  });

  it("allows 172.32.0.1 (just outside RFC-1918 class B range)", async () => {
    mockDns([{ address: "172.32.0.1", family: 4 }]);
    await expect(validateWebhookUrl("http://172.32.0.1/hook")).resolves.toBeUndefined();
  });

  it("allows 172.15.255.255 (just below RFC-1918 class B range)", async () => {
    mockDns([{ address: "172.15.255.255", family: 4 }]);
    await expect(validateWebhookUrl("http://172.15.255.255/hook")).resolves.toBeUndefined();
  });
});
