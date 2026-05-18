import { describe, it, expect } from "vitest";
import { validate, adjustScoreForRegistry } from "../../../src/services/tax-id.js";

describe("detectPatternAnomalies", () => {
  it("flags ascending sequential run (123456789)", () => {
    const result = validate("12-3456789", "US", "EIN");
    expect(result.fraud_risk_score).toBe(15);
  });

  it("flags all-same-digit pattern (111111111)", () => {
    const result = validate("11-1111111", "US", "EIN");
    expect(result.fraud_risk_score).toBe(20);
  });

  it("flags short ascending sequential run (12345)", () => {
    // 5 digits → invalid EIN (length) → base 70 + sequential anomaly 15 = 85
    const result = validate("12345", "US", "EIN");
    expect(result.fraud_risk_score).toBeGreaterThanOrEqual(85);
  });

  it("does NOT flag non-sequential scrambled digits (735281946)", () => {
    const result = validate("73-5281946", "US", "EIN");
    expect(result.fraud_risk_score).toBe(0);
  });

  it("flags descending sequential run (987654321)", () => {
    const result = validate("98-7654321", "US", "EIN");
    expect(result.fraud_risk_score).toBe(15);
  });

  it("flags a partial sequential run embedded in a longer number", () => {
    // "82-3456100" → digits "823456100" contains "3456" ascending run (length 4)
    const result = validate("82-3456100", "US", "EIN");
    expect(result.fraud_risk_score).toBe(15);
  });

  it("does NOT flag scattered same digit — '1211' pattern (no 3-consecutive ±1 run)", () => {
    // digits "521211001": '1' recurs but never forms a 3+ step sequential run
    const result = validate("52-1211001", "US", "EIN");
    expect(result.fraud_risk_score).toBe(0);
  });

  it("returns 0 pattern anomaly for empty string (no digits)", () => {
    const result = validate("", "US", "EIN");
    expect(result.valid).toBe(false);
    expect(result.fraud_risk_score).toBe(70); // invalid EIN length, zero anomaly
  });

  it("returns 0 pattern anomaly for special-character-only input", () => {
    const result = validate("---", "US", "EIN");
    expect(result.valid).toBe(false);
    expect(result.fraud_risk_score).toBe(70); // invalid EIN length, zero anomaly
  });

  it("caps score at 100 for very long all-same-digit string", () => {
    const result = validate("1".repeat(50), "US", "EIN");
    expect(result.valid).toBe(false);
    expect(result.fraud_risk_score).toBeLessThanOrEqual(100);
    expect(result.fraud_risk_score).toBeGreaterThanOrEqual(70);
  });
});

describe("validateEIN", () => {
  it("accepts a valid EIN with dashes", () => {
    const result = validate("12-3456789", "US", "EIN");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("12-3456789");
  });

  it("accepts a valid EIN without dashes and normalizes it", () => {
    const result = validate("123456789", "US", "EIN");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("12-3456789");
  });

  it("rejects EIN with invalid prefix 00", () => {
    const result = validate("00-1234567", "US", "EIN");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("ein_prefix_invalid");
  });

  it("rejects EIN with invalid prefix 97", () => {
    const result = validate("97-1234567", "US", "EIN");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("ein_prefix_invalid");
  });

  it("rejects EIN that is too short", () => {
    const result = validate("12-345", "US", "EIN");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("ein_length_invalid");
  });

  it("rejects EIN that is too long", () => {
    const result = validate("12-3456789012", "US", "EIN");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("ein_length_invalid");
  });
});

describe("validateABN", () => {
  it("accepts a valid ABN", () => {
    const result = validate("51824753556", "AU", "ABN");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("51824753556");
  });

  it("accepts ABN with spaces and normalizes to digits", () => {
    const result = validate("51 824 753 556", "AU", "ABN");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("51824753556");
  });

  it("rejects ABN with invalid checksum", () => {
    const result = validate("12345678901", "AU", "ABN");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("abn_checksum_invalid");
  });

  it("rejects ABN with non-digit characters", () => {
    const result = validate("ABCDEFGHIJK", "AU", "ABN");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("abn_format_invalid");
  });
});

describe("validateGSTIN", () => {
  it("accepts a valid GSTIN", () => {
    const result = validate("27AAPFU0939F1ZV", "IN", "GSTIN");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("27AAPFU0939F1ZV");
  });

  it("is case-insensitive and normalizes to uppercase", () => {
    const result = validate("27aapfu0939f1zv", "IN", "GSTIN");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("27AAPFU0939F1ZV");
  });

  it("accepts GSTIN with state code 01 (lower boundary)", () => {
    const result = validate("01AAPFU0939F1ZV", "IN", "GSTIN");
    expect(result.valid).toBe(true);
  });

  it("accepts GSTIN with state code 38 (upper boundary)", () => {
    const result = validate("38AAPFU0939F1ZV", "IN", "GSTIN");
    expect(result.valid).toBe(true);
  });

  it("rejects GSTIN with state code 99 (above max)", () => {
    const result = validate("99AAPFU0939F1ZV", "IN", "GSTIN");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("gstin_state_invalid");
  });

  it("rejects GSTIN with invalid format", () => {
    const result = validate("INVALID", "IN", "GSTIN");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("gstin_format_invalid");
  });
});

describe("validateVAT", () => {
  it("accepts a valid German VAT", () => {
    const result = validate("DE123456789", "DE", "VAT");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("DE123456789");
  });

  it("accepts a valid GB VAT (9 digits)", () => {
    const result = validate("GB123456789", "GB", "VAT");
    expect(result.valid).toBe(true);
  });

  it("accepts a valid French VAT with alphanumeric prefix", () => {
    const result = validate("FRAB123456789", "FR", "VAT");
    expect(result.valid).toBe(true);
  });

  it("rejects malformed German VAT (too short)", () => {
    const result = validate("DE12345", "DE", "VAT");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("vat_format_invalid");
  });

  it("rejects VAT for unsupported country", () => {
    const result = validate("XX123456789", "XX", "VAT");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("vat_country_not_supported");
  });
});

describe("validateGST (Canada)", () => {
  it("accepts a valid 9-digit BN", () => {
    const result = validate("123456789", "CA", "GST");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("123456789");
  });

  it("accepts a BN with RT account identifier suffix", () => {
    const result = validate("123456789RT0001", "CA", "GST");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("123456789RT0001");
  });

  it("rejects a BN with invalid suffix letters", () => {
    const result = validate("123456789XX0001", "CA", "GST");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("gst_format_invalid");
  });

  it("rejects a non-numeric string", () => {
    const result = validate("invalid", "CA", "GST");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("gst_format_invalid");
  });
});

describe("adjustScoreForRegistry", () => {
  it("adds 30 when not registered", () => {
    expect(adjustScoreForRegistry(10, false, null)).toBe(40);
  });

  it("adds 10 for registration under 6 months ago", () => {
    const recent = new Date();
    recent.setMonth(recent.getMonth() - 2);
    expect(adjustScoreForRegistry(10, true, recent.toISOString().split("T")[0])).toBe(20);
  });

  it("does not penalise registrations older than 6 months", () => {
    const old = new Date();
    old.setFullYear(old.getFullYear() - 3);
    expect(adjustScoreForRegistry(10, true, old.toISOString().split("T")[0])).toBe(10);
  });

  it("caps score at 100", () => {
    expect(adjustScoreForRegistry(90, false, null)).toBe(100);
  });
});
