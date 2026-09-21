import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseInvoiceEmail,
  parseAmountMinor,
  parseDueDateDays,
  previewHashes,
  senderDomain,
  type InvoiceClaimPreview,
} from "../src/email/claims.js";
import { keccak256, toBytes } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, "..", "fixtures");

const loadFixture = (name: string): string => readFileSync(join(fixturesDir, name), "utf8");

describe("parseInvoiceEmail", () => {
  it("extracts the full claim from the deterministic fixture", () => {
    const parsed = parseInvoiceEmail(loadFixture("invoice-sample.eml"));
    expect(parsed.claim).not.toBeNull();
    expect(parsed.claim?.invoiceId).toBe("INV-2026-0001");
    expect(parsed.claim?.issuerDomain).toBe("example-supplier.com");
    expect(parsed.claim?.amountMinor).toBe(125_000n);
    expect(parsed.claim?.currency).toBe("EUR");
    expect(parsed.claim?.dueDateDays).toBe(20503n); // 2026-02-19
    expect(parsed.diagnostics).toEqual([]);
  });

  it("extracts the second fixture with a different issuer domain", () => {
    const parsed = parseInvoiceEmail(loadFixture("invoice-second.eml"));
    expect(parsed.claim?.invoiceId).toBe("INV-2026-0002");
    expect(parsed.claim?.issuerDomain).toBe("second-supplier.org");
    expect(parsed.claim?.amountMinor).toBe(87_550n);
    expect(parsed.claim?.currency).toBe("USD");
  });

  it("reports a missing claim block as a diagnostic, not a throw", () => {
    const email = "From: a@b.co\nSubject: hi\n\nno block here\n";
    const parsed = parseInvoiceEmail(email);
    expect(parsed.claim).toBeNull();
    expect(parsed.diagnostics).toContain("no ProofInvoice/1 claim block found");
  });

  it("reports each missing field as a separate diagnostic", () => {
    const email = [
      "From: billing@example-supplier.com",
      "Subject: broken",
      "",
      "-----BEGIN PROOFINVOICE CLAIM-----",
      "Currency: EUR",
      "-----END PROOFINVOICE CLAIM-----",
    ].join("\n");
    const parsed = parseInvoiceEmail(email);
    expect(parsed.claim).toBeNull();
    expect(parsed.diagnostics).toContain("Invoice-ID missing");
    expect(parsed.diagnostics).toContain("Amount missing");
    expect(parsed.diagnostics).toContain("Due-Date missing");
    expect(parsed.diagnostics).not.toContain("Currency missing");
  });

  it("rejects a missing or malformed From header", () => {
    const email = [
      "Subject: no sender",
      "",
      "-----BEGIN PROOFINVOICE CLAIM-----",
      "Invoice-ID: INV-1",
      "Amount: 10.00",
      "Currency: EUR",
      "Due-Date: 2026-05-20",
      "-----END PROOFINVOICE CLAIM-----",
    ].join("\n");
    const parsed = parseInvoiceEmail(email);
    expect(parsed.claim).toBeNull();
    expect(parsed.diagnostics.some((d) => d.startsWith("From header"))).toBe(true);
  });

  it("rejects an unsupported currency at parse time", () => {
    const email = [
      "From: billing@example-supplier.com",
      "",
      "-----BEGIN PROOFINVOICE CLAIM-----",
      "Invoice-ID: INV-X",
      "Amount: 10.00",
      "Currency: XYZ",
      "Due-Date: 2026-05-20",
      "-----END PROOFINVOICE CLAIM-----",
    ].join("\n");
    const parsed = parseInvoiceEmail(email);
    expect(parsed.claim).toBeNull();
    expect(parsed.diagnostics).toContain("Amount/currency not representable in minor units");
  });

  it("rejects an invalid due date", () => {
    const email = [
      "From: billing@example-supplier.com",
      "",
      "-----BEGIN PROOFINVOICE CLAIM-----",
      "Invoice-ID: INV-X",
      "Amount: 10.00",
      "Currency: EUR",
      "Due-Date: 2026-13-99",
      "-----END PROOFINVOICE CLAIM-----",
    ].join("\n");
    const parsed = parseInvoiceEmail(email);
    expect(parsed.claim).toBeNull();
    expect(parsed.diagnostics).toContain("Due-Date is not a valid YYYY-MM-DD date");
  });
});

describe("parseAmountMinor", () => {
  it("handles two-decimal currencies", () => {
    expect(parseAmountMinor("1250.00", "EUR")).toBe(125_000n);
    expect(parseAmountMinor("0.99", "USD")).toBe(99n);
    expect(parseAmountMinor("5", "GBP")).toBe(500n);
  });

  it("handles zero-decimal currencies", () => {
    expect(parseAmountMinor("1250", "JPY")).toBe(1250n);
  });

  it("rejects invalid amounts", () => {
    expect(parseAmountMinor("-5", "EUR")).toBeNull();
    expect(parseAmountMinor("1.234", "EUR")).toBeNull();
    expect(parseAmountMinor("abc", "EUR")).toBeNull();
  });
});

describe("parseDueDateDays", () => {
  it("matches known epoch-day values", () => {
    expect(parseDueDateDays("2026-02-19")).toBe(20_503n);
    expect(parseDueDateDays("1970-01-01")).toBe(0n);
    expect(parseDueDateDays("2026-03-08")).toBe(20_520n);
  });

  it("rejects malformed dates", () => {
    expect(parseDueDateDays("20/02/2026")).toBeNull();
    expect(parseDueDateDays("2026-00-10")).toBeNull();
  });
});

describe("previewHashes", () => {
  it("hashes consistently and case-insensitively", () => {
    const a = previewHashes({
      invoiceId: "inv-2026-0001",
      issuerDomain: "EXAMPLE-Supplier.com",
      amountMinor: 1n,
      currency: "EUR",
      dueDateDays: 1n,
    });
    const b = previewHashes({
      invoiceId: "INV-2026-0001",
      issuerDomain: "example-supplier.com",
      amountMinor: 1n,
      currency: "EUR",
      dueDateDays: 1n,
    });
    expect(a).toEqual(b);
  });
});
