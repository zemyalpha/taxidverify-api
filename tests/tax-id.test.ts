import { describe, it, expect } from "vitest";
import { validate, adjustScoreForRegistry } from "../src/services/tax-id.js";

describe("tax-id service", () => {
  describe("EIN validation", () => {
    it("accepts a valid EIN with dashes", () => {
      const result = validate("12-3456789", "US", "EIN");
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe("12-3456789");
    });

    it("accepts a valid EIN without dashes", () => {
      const result = validate("123456789", "US", "EIN");
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe("12-3456789");
    });

    it("rejects EIN with invalid prefix 00", () => {
      const result = validate("00-1234567", "US", "EIN");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("ein_prefix_invalid");
    });

    it("rejects EIN with invalid prefix 07", () => {
      const result = validate("07-1234567", "US", "EIN");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("ein_prefix_invalid");
    });

    it("rejects EIN with invalid prefix 96", () => {
      const result = validate("96-1234567", "US", "EIN");
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
      const result = validate("12-34567890", "US", "EIN");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("ein_length_invalid");
    });
  });

  describe("VAT validation", () => {
    it("accepts a valid German VAT", () => {
      const result = validate("DE123456789", "DE", "VAT");
      expect(result.valid).toBe(true);
    });

    it("accepts a valid GB VAT", () => {
      const result = validate("GB123456789", "GB", "VAT");
      expect(result.valid).toBe(true);
    });

    it("accepts a valid French VAT", () => {
      const result = validate("FRAB123456789", "FR", "VAT");
      expect(result.valid).toBe(true);
    });

    it("rejects malformed DE VAT", () => {
      const result = validate("DE12345", "DE", "VAT");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("vat_format_invalid");
    });

    it("rejects unsupported country", () => {
      const result = validate("XX123456789", "XX", "VAT");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("vat_country_not_supported");
    });
  });

  describe("ABN validation", () => {
    it("accepts a valid ABN", () => {
      // 51 824 753 556 is a real test ABN with valid checksum
      const result = validate("51824753556", "AU", "ABN");
      expect(result.valid).toBe(true);
    });

    it("accepts ABN with spaces (normalizes to digits)", () => {
      const result = validate("51 824 753 556", "AU", "ABN");
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe("51824753556");
    });

    it("rejects ABN with bad checksum", () => {
      const result = validate("12345678901", "AU", "ABN");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("abn_checksum_invalid");
    });

    it("rejects ABN with bad format", () => {
      const result = validate("ABC", "AU", "ABN");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("abn_format_invalid");
    });
  });

  describe("GST validation (Canada)", () => {
    it("accepts a valid 9-digit BN", () => {
      const result = validate("123456789", "CA", "GST");
      expect(result.valid).toBe(true);
    });

    it("accepts a BN with RT suffix", () => {
      const result = validate("123456789RT0001", "CA", "GST");
      expect(result.valid).toBe(true);
    });

    it("rejects invalid GST", () => {
      const result = validate("invalid", "CA", "GST");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("gst_format_invalid");
    });

    it("rejects BN with invalid RT suffix (wrong letters)", () => {
      const result = validate("123456789XX0001", "CA", "GST");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("gst_format_invalid");
    });
  });

  describe("GSTIN validation (India)", () => {
    it("accepts a valid GSTIN", () => {
      const result = validate("27AAPFU0939F1ZV", "IN", "GSTIN");
      expect(result.valid).toBe(true);
    });

    it("rejects GSTIN with invalid state code 99 (above 38)", () => {
      const result = validate("99AAPFU0939F1ZV", "IN", "GSTIN");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("gstin_state_invalid");
    });

    it("rejects GSTIN with state code 39 (above max 38)", () => {
      const result = validate("39AAPFU0939F1ZV", "IN", "GSTIN");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("gstin_state_invalid");
    });

    it("accepts GSTIN with state code 01 (lower boundary)", () => {
      const result = validate("01AAPFU0939F1ZV", "IN", "GSTIN");
      expect(result.valid).toBe(true);
    });

    it("accepts GSTIN with state code 38 (upper boundary)", () => {
      const result = validate("38AAPFU0939F1ZV", "IN", "GSTIN");
      expect(result.valid).toBe(true);
    });

    it("is case-insensitive (normalizes to uppercase)", () => {
      const result = validate("27aapfu0939f1zv", "IN", "GSTIN");
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe("27AAPFU0939F1ZV");
    });

    it("rejects GSTIN with bad format", () => {
      const result = validate("INVALID", "IN", "GSTIN");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("gstin_format_invalid");
    });
  });

  describe("fraud risk scoring", () => {
    it("gives a high score to invalid IDs", () => {
      const result = validate("00-1234567", "US", "EIN");
      expect(result.fraud_risk_score).toBeGreaterThanOrEqual(70);
    });

    it("adds penalty for high-risk country", () => {
      // Use non-sequential digits to avoid the pattern-anomaly bump
      const valid = validate("82-7461938", "US", "EIN");
      const invalidNG = validate("00-7461938", "NG", "EIN");
      expect(valid.fraud_risk_score).toBe(0);
      // invalid (70) + high-risk (20) = 90
      expect(invalidNG.fraud_risk_score).toBe(90);
    });

    it("adds penalty for medium-risk country", () => {
      // Non-sequential digits avoid the pattern-anomaly bump
      const result = validate("82-7461938", "RU", "EIN");
      expect(result.fraud_risk_score).toBe(10);
    });

    it("detects all-same-digit pattern anomaly", () => {
      const result = validate("111111111", "US", "EIN");
      // Invalid prefix (70) + pattern anomaly (20) = 90
      expect(result.fraud_risk_score).toBeGreaterThanOrEqual(20);
    });

    it("caps score at 100", () => {
      const result = validate("000000000", "NG", "EIN");
      expect(result.fraud_risk_score).toBeLessThanOrEqual(100);
    });
  });

  describe("adjustScoreForRegistry", () => {
    it("adds 30 to score if not registered", () => {
      const score = adjustScoreForRegistry(10, false, null);
      expect(score).toBe(40);
    });

    it("adds 10 if newly registered (under 6 months)", () => {
      const recentDate = new Date();
      recentDate.setMonth(recentDate.getMonth() - 1);
      const score = adjustScoreForRegistry(10, true, recentDate.toISOString().split("T")[0]);
      expect(score).toBe(20);
    });

    it("does not penalize old registrations", () => {
      const oldDate = new Date();
      oldDate.setFullYear(oldDate.getFullYear() - 5);
      const score = adjustScoreForRegistry(10, true, oldDate.toISOString().split("T")[0]);
      expect(score).toBe(10);
    });

    it("caps adjusted score at 100", () => {
      const score = adjustScoreForRegistry(90, false, null);
      expect(score).toBe(100);
    });
  });

  describe("detectPatternAnomalies (tested via validate)", () => {
    it("scores +15 for sequential ascending digits", () => {
      const result = validate("12-3456789", "US", "EIN");
      expect(result.fraud_risk_score).toBe(15);
    });

    it("scores +15 for sequential descending digits", () => {
      const result = validate("98-7654321", "US", "EIN");
      expect(result.fraud_risk_score).toBe(15);
    });

    it("scores +20 for all-same-digit (repeated) pattern", () => {
      const result = validate("11-1111111", "US", "EIN");
      expect(result.fraud_risk_score).toBe(20);
    });

    it("scores 0 for a normal mixed-digit pattern", () => {
      const result = validate("82-7461938", "US", "EIN");
      expect(result.fraud_risk_score).toBe(0);
    });

    it("does NOT flag scattered same digit — 1211 pattern has no 3-run", () => {
      // "52-1211001": digits "521211001" — '1' appears multiple times but
      // no 3+ consecutive ±1 sequential run exists, so anomaly score must be 0.
      const result = validate("52-1211001", "US", "EIN");
      expect(result.fraud_risk_score).toBe(0);
    });

    it("scores 0 anomaly for empty string input (no digits)", () => {
      const result = validate("", "US", "EIN");
      expect(result.valid).toBe(false);
      expect(result.fraud_risk_score).toBe(70); // invalid EIN length only
    });

    it("scores 0 anomaly for special-character-only input", () => {
      const result = validate("---", "US", "EIN");
      expect(result.valid).toBe(false);
      expect(result.fraud_risk_score).toBe(70); // invalid EIN length only
    });

    it("handles very long all-same-digit string without score overflow", () => {
      const result = validate("1".repeat(50), "US", "EIN");
      expect(result.valid).toBe(false);
      expect(result.fraud_risk_score).toBeLessThanOrEqual(100);
    });

    it("scores +15 for a sequential run embedded mid-string", () => {
      // "82-3456100": digits "823456100" — "3456" is a 4-digit ascending run
      const result = validate("82-3456100", "US", "EIN");
      expect(result.fraud_risk_score).toBe(15);
    });
  });
});
