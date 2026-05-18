import { TaxIdType } from "../types/index.js";

export interface ValidationOutput {
  valid: boolean;
  normalized: string;
  fraud_risk_score: number;
  error?: string;
}

// Country risk tiers: low (0), medium (+10), high (+20)
const HIGH_RISK_COUNTRIES = new Set([
  "NG", "PK", "BD", "MM", "KH", "LA", "ZW", "SD", "SY", "IQ", "AF", "LY", "SO", "YE",
]);
const MEDIUM_RISK_COUNTRIES = new Set([
  "RU", "UA", "BY", "MD", "GE", "AZ", "AM", "KZ", "UZ", "TM", "TJ", "KG",
]);

// EIN validation (US)
// Format: XX-XXXXXXX, invalid prefixes per IRS guidance
const INVALID_EIN_PREFIXES = new Set([
  "00", "07", "08", "09", "17", "18", "19", "28", "29", "49", "69", "70", "78", "79", "89", "96", "97",
]);

function validateEIN(raw: string): { valid: boolean; normalized: string; error?: string } {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 9) return { valid: false, normalized: raw, error: "ein_length_invalid" };
  const prefix = digits.slice(0, 2);
  if (INVALID_EIN_PREFIXES.has(prefix)) return { valid: false, normalized: raw, error: "ein_prefix_invalid" };
  const normalized = `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return { valid: true, normalized };
}

// VAT validation patterns per country
const VAT_PATTERNS: Record<string, RegExp> = {
  AT: /^ATU\d{8}$/,
  BE: /^BE0\d{9}$/,
  BG: /^BG\d{9,10}$/,
  CY: /^CY\d{8}[A-Z]$/,
  CZ: /^CZ\d{8,10}$/,
  DE: /^DE\d{9}$/,
  DK: /^DK\d{8}$/,
  EE: /^EE\d{9}$/,
  EL: /^EL\d{9}$/,
  ES: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/,
  FI: /^FI\d{8}$/,
  FR: /^FR[A-Z0-9]{2}\d{9}$/,
  GB: /^GB(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
  HR: /^HR\d{11}$/,
  HU: /^HU\d{8}$/,
  IE: /^IE\d{7}[A-Z]{1,2}$/,
  IT: /^IT\d{11}$/,
  LT: /^LT(\d{9}|\d{12})$/,
  LU: /^LU\d{8}$/,
  LV: /^LV\d{11}$/,
  MT: /^MT\d{8}$/,
  NL: /^NL\d{9}B\d{2}$/,
  PL: /^PL\d{10}$/,
  PT: /^PT\d{9}$/,
  RO: /^RO\d{2,10}$/,
  SE: /^SE\d{12}$/,
  SI: /^SI\d{8}$/,
  SK: /^SK\d{10}$/,
};

function validateVAT(raw: string, country: string): { valid: boolean; normalized: string; error?: string } {
  const normalized = raw.toUpperCase().replace(/\s/g, "");
  const pattern = VAT_PATTERNS[country];
  if (!pattern) return { valid: false, normalized, error: "vat_country_not_supported" };
  if (!pattern.test(normalized)) return { valid: false, normalized, error: "vat_format_invalid" };
  return { valid: true, normalized };
}

// GST (Canada): 9-digit BN optionally followed by RT + 4 digits
function validateGST(raw: string): { valid: boolean; normalized: string; error?: string } {
  const clean = raw.replace(/\s/g, "").toUpperCase();
  if (/^\d{9}(RT\d{4})?$/.test(clean)) return { valid: true, normalized: clean };
  return { valid: false, normalized: raw, error: "gst_format_invalid" };
}

// ABN (Australia): 11 digits with checksum
function validateABN(raw: string): { valid: boolean; normalized: string; error?: string } {
  const digits = raw.replace(/\s/g, "");
  if (!/^\d{11}$/.test(digits)) return { valid: false, normalized: raw, error: "abn_format_invalid" };
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const d = digits.split("").map(Number);
  d[0] -= 1;
  const sum = d.reduce((acc, v, i) => acc + v * weights[i], 0);
  if (sum % 89 !== 0) return { valid: false, normalized: raw, error: "abn_checksum_invalid" };
  return { valid: true, normalized: digits };
}

// GSTIN (India): 15-char format: 2-digit state + 10-char PAN + entity + Z + checksum
function validateGSTIN(raw: string): { valid: boolean; normalized: string; error?: string } {
  const normalized = raw.toUpperCase().replace(/\s/g, "");
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(normalized)) {
    return { valid: false, normalized, error: "gstin_format_invalid" };
  }
  const stateCode = parseInt(normalized.slice(0, 2), 10);
  if (stateCode < 1 || stateCode > 38) return { valid: false, normalized, error: "gstin_state_invalid" };
  return { valid: true, normalized };
}

function detectPatternAnomalies(id: string): number {
  const digits = id.replace(/\D/g, "");
  if (!digits) return 0;
  if (/^(\d)\1+$/.test(digits)) return 20;
  let runLen = 1;
  let dir = 0;
  for (let i = 1; i < digits.length; i++) {
    const diff = Number(digits[i]) - Number(digits[i - 1]);
    if (diff === 1 || diff === -1) {
      if (dir === 0 || dir === diff) {
        dir = diff;
        runLen++;
        if (runLen >= 3) return 15;
      } else {
        runLen = 2;
        dir = diff;
      }
    } else {
      runLen = 1;
      dir = 0;
    }
  }
  return 0;
}

export function validate(raw: string, country: string, type: TaxIdType): ValidationOutput {
  let result: { valid: boolean; normalized: string; error?: string };

  switch (type) {
    case "EIN":
      result = validateEIN(raw);
      break;
    case "VAT":
      result = validateVAT(raw, country.toUpperCase());
      break;
    case "GST":
      result = validateGST(raw);
      break;
    case "ABN":
      result = validateABN(raw);
      break;
    case "GSTIN":
      result = validateGSTIN(raw);
      break;
    default:
      result = { valid: false, normalized: raw, error: "type_not_supported" };
  }

  let score = 0;
  if (!result.valid) {
    score += 70;
  }

  if (HIGH_RISK_COUNTRIES.has(country.toUpperCase())) score += 20;
  else if (MEDIUM_RISK_COUNTRIES.has(country.toUpperCase())) score += 10;

  score += detectPatternAnomalies(raw);

  score = Math.min(100, score);

  return {
    valid: result.valid,
    normalized: result.normalized,
    fraud_risk_score: score,
    error: result.error,
  };
}

export function adjustScoreForRegistry(
  baseScore: number,
  registered: boolean,
  registrationDate: string | null,
): number {
  let score = baseScore;
  if (!registered) {
    score += 30;
  } else if (registrationDate) {
    const ageMs = Date.now() - new Date(registrationDate).getTime();
    const ageMonths = ageMs / (1000 * 60 * 60 * 24 * 30);
    if (ageMonths < 6) score += 10;
  }
  return Math.min(100, score);
}
