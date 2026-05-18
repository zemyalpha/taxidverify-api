import { TaxIdType } from "../types/index.js";
import pino from "pino";

const logger = pino({ name: "registry" });

export interface RegistryResult {
  registered: boolean;
  business_name?: string;
  registered_address?: string;
  registration_date?: string;
}

// EU countries whose VAT numbers are verifiable via VIES SOAP
export const VIES_COUNTRIES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES",
  "FI", "FR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT",
  "NL", "PL", "PT", "RO", "SE", "SI", "SK", "XI",
]);

const VIES_ENDPOINT =
  "https://ec.europa.eu/taxation_customs/vies/services/checkVatService";
const VIES_TIMEOUT_MS = 5000;

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildViesSoapEnvelope(countryCode: string, vatNumber: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:urn="urn:ec.europa.eu:taxud:vies:services:checkVat:types">
  <soapenv:Header/>
  <soapenv:Body>
    <urn:checkVat>
      <urn:countryCode>${escapeXml(countryCode)}</urn:countryCode>
      <urn:vatNumber>${escapeXml(vatNumber)}</urn:vatNumber>
    </urn:checkVat>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function parseViesResponse(xml: string): RegistryResult | null {
  // SOAP faults mean the service or member state is unavailable — fall back
  if (/<(?:soap:|soapenv:)?Fault/i.test(xml)) return null;

  const validMatch = xml.match(/<valid>(true|false)<\/valid>/);
  if (!validMatch) return null;

  if (validMatch[1] !== "true") return { registered: false };

  const nameRaw = xml.match(/<name>([\s\S]*?)<\/name>/)?.[1]?.trim() ?? "";
  const addrRaw = xml.match(/<address>([\s\S]*?)<\/address>/)?.[1]?.trim() ?? "";

  return {
    registered: true,
    business_name: nameRaw && nameRaw !== "---" ? nameRaw : undefined,
    registered_address: addrRaw && addrRaw !== "---" ? addrRaw : undefined,
    // VIES confirms current validity only — no registration date returned
  };
}

async function lookupVies(
  normalizedVat: string,
  country: string,
): Promise<RegistryResult | null> {
  // Strip the 2-letter country prefix to get the bare VAT number VIES expects
  const vatNumber = normalizedVat.slice(2);
  const body = buildViesSoapEnvelope(country, vatNumber);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VIES_TIMEOUT_MS);

    const res = await fetch(VIES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=UTF-8",
        SOAPAction: "",
      },
      body,
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    const text = await res.text();
    return parseViesResponse(text);
  } catch (err) {
    logger.warn({ country, err }, "VIES lookup failed, falling back to simulation");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Simulation fallback (used for non-EU countries and when VIES is unavailable)
// ---------------------------------------------------------------------------

const DEFAULT_MIN_DELAY = 100;
const DEFAULT_MAX_DELAY = 900;

async function simulatedLookup(id: string, country: string): Promise<RegistryResult> {
  const minDelay = process.env.REGISTRY_MIN_DELAY
    ? parseInt(process.env.REGISTRY_MIN_DELAY, 10)
    : DEFAULT_MIN_DELAY;
  const maxDelay = process.env.REGISTRY_MAX_DELAY
    ? parseInt(process.env.REGISTRY_MAX_DELAY, 10)
    : DEFAULT_MAX_DELAY;
  const delay = minDelay + Math.random() * Math.max(0, maxDelay - minDelay);
  if (delay > 0) await new Promise((r) => setTimeout(r, delay));

  const digits = id.replace(/\D/g, "");
  const seed = digits.split("").reduce((acc, d) => acc + parseInt(d, 10), 0);
  if (seed % 5 === 0) return { registered: false };

  const names: Record<string, string[]> = {
    US: ["Acme Corp", "Global Solutions LLC", "Tech Ventures Inc", "Digital Services Co"],
    GB: ["UK Holdings Ltd", "British Digital PLC", "London Fintech Ltd"],
    AU: ["Australian Services Pty Ltd", "Sydney Tech PTY"],
    IN: ["India Pvt Ltd", "Mumbai Tech Solutions"],
    CA: ["Canadian Holdings Inc", "Toronto Digital Corp"],
  };
  const cities: Record<string, string> = {
    US: "New York, NY, USA",
    GB: "London, UK",
    AU: "Sydney, NSW, Australia",
    IN: "Mumbai, Maharashtra, India",
    CA: "Toronto, ON, Canada",
  };

  const countryNames = names[country] ?? ["Global Business Corp"];
  const yearsAgo = 1 + (seed % 14);
  const regDate = new Date();
  regDate.setFullYear(regDate.getFullYear() - yearsAgo);

  return {
    registered: true,
    business_name: countryNames[seed % countryNames.length],
    registered_address: cities[country] ?? `${country} Business District`,
    registration_date: regDate.toISOString().split("T")[0],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function lookupRegistry(
  id: string,
  country: string,
  type: TaxIdType,
): Promise<RegistryResult> {
  const viesEnabled = process.env.VIES_ENABLED !== "false";

  if (viesEnabled && type === "VAT" && VIES_COUNTRIES.has(country.toUpperCase())) {
    const viesResult = await lookupVies(id.toUpperCase().replace(/\s/g, ""), country.toUpperCase());
    if (viesResult !== null) {
      logger.info({ country, id }, "VIES lookup succeeded");
      return viesResult;
    }
    // VIES unavailable — fall through to simulation
    logger.warn({ country }, "VIES unavailable, using simulation fallback");
  }

  return simulatedLookup(id, country.toUpperCase());
}
