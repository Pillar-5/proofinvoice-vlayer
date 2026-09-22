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
  SUPPORTED_CURRENCIES,
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
    expect(parsed.diagnostics).toContain("Invoice-ID missing");
    expect(parsed.diagnostics).toContain("Amount missing");
    expect(parsed.diagnostics).toContain("Currency missing");
    expect(parsed.diagnostics).toContain("Due-Date missing");
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

  it("rejects currencies outside the cross-layer allow-list", () => {
    // JPY (0 decimals) and BHD (3 decimals) are deliberately unsupported: both
    // sides convert to minor units by appending exactly two fraction digits, so
    // a zero/three-decimal currency would disagree between preview and prover.
    // They are also absent from InvoiceClaimLib.isSupportedCurrency.
    expect(parseAmountMinor("1250", "JPY")).toBeNull();
    expect(parseAmountMinor("1250", "KRW")).toBeNull();
    expect(parseAmountMinor("1250", "BHD")).toBeNull();
    expect(parseAmountMinor("1250", "XYZ")).toBeNull();
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

describe("cross-layer currency allow-list parity", () => {
  /**
   * The TypeScript preview and the Solidity prover/verifier must accept exactly
   * the same set of currencies. If they drift, the UI would happily preview a
   * claim that the prover can never produce — or worse, hash an amount the
   * verifier rejects. This test parses the authoritative Solidity allow-list out
   * of the source file, so any drift fails CI instead of reaching a user.
   */
  it("matches InvoiceClaimLib.isSupportedCurrency exactly", () => {
    const solidityPath = resolve(
      here,
      "..",
      "contracts",
      "src",
      "libraries",
      "InvoiceClaim.sol",
    );
    const soliditySource = readFileSync(solidityPath, "utf8");

    const isSupportedBody = /function isSupportedCurrency[\s\S]*?\n {4}\}/.exec(soliditySource);
    expect(isSupportedBody).not.toBeNull();

    const solidityCurrencies = [
      ...(isSupportedBody as RegExpExecArray)[0].matchAll(/bytes3\("([A-Z]{3})"\)/g),
    ]
      .map((match) => match[1])
      .sort();

    const tsCurrencies = Object.keys(SUPPORTED_CURRENCIES).sort();

    expect(solidityCurrencies.length).toBeGreaterThan(0);
    expect(tsCurrencies).toEqual(solidityCurrencies);
  });

  it("declares every supported currency as two-decimal", () => {
    for (const [code, decimals] of Object.entries(SUPPORTED_CURRENCIES)) {
      expect(decimals, `${code} must be a two-decimal currency`).toBe(2);
    }
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
