import { lookup } from "node:dns/promises";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.internal",
  "169.254.169.254",
]);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 127) return true;                             // 127.0.0.0/8 loopback
  if (a === 10) return true;                              // 10.0.0.0/8 RFC-1918
  if (a === 172 && b >= 16 && b <= 31) return true;      // 172.16.0.0/12 RFC-1918
  if (a === 192 && b === 168) return true;                // 192.168.0.0/16 RFC-1918
  if (a === 169 && b === 254) return true;                // 169.254.0.0/16 link-local / cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true;     // 100.64.0.0/10 CGNAT
  if (a === 0) return true;                               // 0.0.0.0/8 "this" network
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const n = ip.toLowerCase();
  if (n === "::1") return true;                           // loopback
  if (n.startsWith("fe80:")) return true;                 // fe80::/10 link-local
  if (n.startsWith("fc") || n.startsWith("fd")) return true; // fc00::/7 unique-local
  if (n.startsWith("::ffff:")) {
    const suffix = n.slice(7);
    // Dotted-quad form: "::ffff:127.0.0.1"
    if (suffix.includes(".")) return isPrivateIPv4(suffix);
    // Hex form from WHATWG URL normalization: "::ffff:7f00:1" → two colon-separated groups
    const parts = suffix.split(":");
    if (parts.length === 2) {
      const hi = parseInt(parts[0], 16);
      const lo = parseInt(parts[1], 16);
      const dotted = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isPrivateIPv4(dotted);
    }
  }
  return false;
}

function isPrivateIP(ip: string): boolean {
  return ip.includes(":") ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

export class SSRFError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SSRFError";
  }
}

/** Validates that a webhook URL does not point at private/internal infrastructure. */
export async function validateWebhookUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SSRFError("Invalid URL format");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new SSRFError("URL must use HTTP or HTTPS protocol");
  }

  // WHATWG URL keeps brackets around IPv6 literals (e.g. "[::1]") in hostname.
  // Strip them so the private-IP check works correctly.
  let hostname = parsed.hostname.toLowerCase();
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1);
  }

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new SSRFError(`URL hostname '${hostname}' is not allowed`);
  }

  // If caller passed a bare IP address, check it immediately
  if (isPrivateIP(hostname)) {
    throw new SSRFError("URL must not point to a private or reserved IP address");
  }

  // Resolve hostname and check every returned address
  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new SSRFError("URL hostname could not be resolved");
  }

  for (const { address } of addresses) {
    if (isPrivateIP(address)) {
      throw new SSRFError("URL resolves to a private or reserved IP address");
    }
  }
}
