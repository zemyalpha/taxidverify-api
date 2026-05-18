import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateWebhookUrl, SSRFError } from "../../../src/utils/ssrf.js";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

import { lookup } from "node:dns/promises";
const mockLookup = vi.mocked(lookup);

function mockDns(addresses: { address: string; family: number }[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockLookup.mockResolvedValue(addresses as any);
}

beforeEach(() => {
  mockLookup.mockReset();
  mockDns([{ address: "93.184.216.34", family: 4 }]);
});

describe("isPrivateIP — IPv4 private ranges (tested via validateWebhookUrl)", () => {
  it("blocks 127.0.0.1 (loopback)", async () => {
    await expect(validateWebhookUrl("http://127.0.0.1/hook")).rejects.toThrow(SSRFError);
  });

  it("blocks 10.0.0.1 (RFC-1918 class A)", async () => {
    await expect(validateWebhookUrl("http://10.0.0.1/hook")).rejects.toThrow(SSRFError);
  });

  it("blocks 192.168.1.1 (RFC-1918 class C)", async () => {
    await expect(validateWebhookUrl("http://192.168.1.1/hook")).rejects.toThrow(SSRFError);
  });

  it("blocks 172.16.0.1 (RFC-1918 class B lower boundary)", async () => {
    await expect(validateWebhookUrl("http://172.16.0.1/hook")).rejects.toThrow(SSRFError);
  });

  it("blocks 172.31.255.255 (RFC-1918 class B upper boundary)", async () => {
    await expect(validateWebhookUrl("http://172.31.255.255/hook")).rejects.toThrow(SSRFError);
  });

  it("blocks 169.254.169.254 (link-local / cloud metadata)", async () => {
    await expect(validateWebhookUrl("http://169.254.169.254/hook")).rejects.toThrow(SSRFError);
  });

  it("allows 8.8.8.8 (public IP — Google DNS)", async () => {
    mockDns([{ address: "8.8.8.8", family: 4 }]);
    await expect(validateWebhookUrl("http://8.8.8.8/hook")).resolves.toBeUndefined();
  });

  it("allows 1.1.1.1 (public IP — Cloudflare DNS)", async () => {
    mockDns([{ address: "1.1.1.1", family: 4 }]);
    await expect(validateWebhookUrl("http://1.1.1.1/hook")).resolves.toBeUndefined();
  });
});

describe("isPrivateIP — IPv6 private ranges", () => {
  it("blocks ::1 (IPv6 loopback)", async () => {
    await expect(validateWebhookUrl("http://[::1]/hook")).rejects.toThrow(SSRFError);
  });

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

describe("isPrivateIP — IPv4-mapped IPv6 addresses", () => {
  it("blocks ::ffff:127.0.0.1 (IPv4-mapped loopback)", async () => {
    await expect(validateWebhookUrl("http://[::ffff:127.0.0.1]/hook")).rejects.toThrow(SSRFError);
  });

  it("blocks ::ffff:10.0.0.1 (IPv4-mapped RFC-1918)", async () => {
    await expect(validateWebhookUrl("http://[::ffff:10.0.0.1]/hook")).rejects.toThrow(SSRFError);
  });

  it("blocks ::ffff:192.168.1.1 (IPv4-mapped RFC-1918)", async () => {
    await expect(validateWebhookUrl("http://[::ffff:192.168.1.1]/hook")).rejects.toThrow(SSRFError);
  });
});

describe("isPrivateIP — DNS resolution of hostnames to private IPs", () => {
  it("blocks hostname resolving to 10.x.x.x", async () => {
    mockDns([{ address: "10.20.30.40", family: 4 }]);
    await expect(validateWebhookUrl("https://internal.example.com/hook")).rejects.toThrow(SSRFError);
  });

  it("blocks hostname resolving to 192.168.x.x", async () => {
    mockDns([{ address: "192.168.1.50", family: 4 }]);
    await expect(validateWebhookUrl("https://corp.internal/hook")).rejects.toThrow(SSRFError);
  });

  it("allows hostname resolving to a public IP", async () => {
    mockDns([{ address: "93.184.216.34", family: 4 }]);
    await expect(validateWebhookUrl("https://example.com/hook")).resolves.toBeUndefined();
  });

  it("blocks DNS rebinding: public-looking hostname that resolves to private IP", async () => {
    mockDns([{ address: "172.16.0.1", family: 4 }]);
    await expect(validateWebhookUrl("https://trusted.example.com/hook")).rejects.toThrow(SSRFError);
  });

  it("blocks when DNS resolution fails (ENOTFOUND)", async () => {
    mockLookup.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(validateWebhookUrl("https://nonexistent.invalid/hook")).rejects.toThrow(SSRFError);
  });
});

describe("isPrivateIP — CGNAT range (100.64.0.0/10)", () => {
  it("blocks 100.64.0.1 (CGNAT lower boundary)", async () => {
    await expect(validateWebhookUrl("http://100.64.0.1/hook")).rejects.toThrow(SSRFError);
  });

  it("blocks 100.127.255.255 (CGNAT upper boundary)", async () => {
    await expect(validateWebhookUrl("http://100.127.255.255/hook")).rejects.toThrow(SSRFError);
  });

  it("allows 100.128.0.1 (just outside CGNAT range)", async () => {
    mockDns([{ address: "100.128.0.1", family: 4 }]);
    await expect(validateWebhookUrl("http://100.128.0.1/hook")).resolves.toBeUndefined();
  });
});

describe("isPrivateIP — localhost and zero-network variants", () => {
  it("blocks 0.0.0.0 ('this' network)", async () => {
    await expect(validateWebhookUrl("http://0.0.0.0/hook")).rejects.toThrow(SSRFError);
  });

  it("blocks 127.0.0.2 (within 127.0.0.0/8 loopback range)", async () => {
    await expect(validateWebhookUrl("http://127.0.0.2/hook")).rejects.toThrow(SSRFError);
  });
});

describe("isPrivateIP — IPv4-mapped IPv6 hex form", () => {
  it("blocks ::ffff:7f00:1 (IPv4-mapped 127.0.0.1 in hex notation)", async () => {
    // ::ffff:7f00:0001 encodes 127.0.0.1 in hex groups
    await expect(validateWebhookUrl("http://[::ffff:7f00:1]/hook")).rejects.toThrow(SSRFError);
  });

  it("blocks ::ffff:c0a8:101 (IPv4-mapped 192.168.1.1 in hex notation)", async () => {
    // ::ffff:c0a8:0101 encodes 192.168.1.1
    await expect(validateWebhookUrl("http://[::ffff:c0a8:101]/hook")).rejects.toThrow(SSRFError);
  });
});
