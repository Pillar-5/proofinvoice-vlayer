import { keccak256, toBytes } from "viem";

/**
 * Client-side mirror of `ProofInvoiceProver`: parses a `.eml` file, extracts
 * the canonical `ProofInvoice/1` header block and normalises the five claim
 * fields exactly as the prover does. This drives the "parsed claims" UI before
 * proving; the prover re-derives everything inside the zkEVM, so any mismatch
 * between the two surfaces as a verifier revert rather than a silent lie.
 */

export interface InvoiceClaimPreview {
  invoiceId: string;
  issuerDomain: string;
  amountMinor: bigint;
  currency: string;
  dueDateDays: bigint;
}

export interface ParsedEmail {
  /** Fully parsed canonical claims, or null when the block is missing/incomplete. */
  claim: InvoiceClaimPreview | null;
  /** Non-fatal diagnostics explaining why the claim is null, when it is. */
  diagnostics: string[];
  /** Raw canonical header block, when present (for display only). */
  headerBlock: string | null;
}

const CURRENCY_MINOR_UNITS: Record<string, number> = {
  USD: 2, EUR: 2, GBP: 2, CHF: 2, JPY: 0, KRW: 0, BHD: 3, KWD: 3, TND: 3,
};

function headerValue(block: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\r?\\n)${name}:[ \\t]*([^\\r\\n]+)`, "i");
  const match = re.exec(block);
  const captured = match?.[1];
  return captured !== undefined ? captured.trim() : null;
}

/** Normalises an RFC 5322 `From` value to the bare lowercase domain. */
export function senderDomain(fromValue: string): string | null {
  const at = fromValue.lastIndexOf("@");
  if (at === -1) return null;
  const raw = fromValue.slice(at + 1).trim().replace(/[>"]\s*$/, "");
  return /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(raw) ? raw.toLowerCase() : null;
}

/** Converts "1250.00" + "EUR" into minor units, mirroring InvoiceClaimLib. */
export function parseAmountMinor(amount: string, currency: string): bigint | null {
  const decimals = CURRENCY_MINOR_UNITS[currency];
  if (decimals === undefined) return null;
  const match = /^([0-9]{1,16})(?:\.([0-9]{1,2}))?$/.exec(amount.trim());
  if (!match || match[1] === undefined) return null;
  const whole = match[1];
  const frac = (match[2] ?? "").padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole + frac);
}

/** "2026-05-20" -> days since epoch (Howard Hinnant's days_from_civil). */
export function parseDueDateDays(date: string): bigint | null {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(date.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return BigInt(era * 146_097 + doe - 719_468);
}

/**
 * Parses a full RFC 822 source string, mirroring the prover exactly: the
 * `Invoice-ID:` / `Amount:` / `Currency:` / `Due-Date:` header fields are
 * matched anywhere in the message (the Solidity regexes are not anchored to a
 * block), and the issuer domain comes from the `From` header. A *missing*
 * field is a diagnostic, not a thrown error — proving is what decides.
 */
export function parseInvoiceEmail(mimeSource: string): ParsedEmail {
  const diagnostics: string[] = [];

  const fromHeader = /(?:^|\r?\n)From:[ \t]*([^\r\n]+)/i.exec(mimeSource);
  const domain = fromHeader ? senderDomain(fromHeader[1] ?? "") : null;
  if (!domain) diagnostics.push("From header missing or not a bare mailbox@domain");

  const invoiceId = headerValue(mimeSource, "Invoice-ID");
  if (!invoiceId) diagnostics.push("Invoice-ID missing");
  const amountStr = headerValue(mimeSource, "Amount");
  if (!amountStr) diagnostics.push("Amount missing");
  const currencyRaw = headerValue(mimeSource, "Currency");
  const currency = currencyRaw ? currencyRaw.toUpperCase() : null;
  if (!currency) diagnostics.push("Currency missing");
  const dueDate = headerValue(mimeSource, "Due-Date");
  if (!dueDate) diagnostics.push("Due-Date missing");

  if (diagnostics.length > 0) {
    return { claim: null, diagnostics, headerBlock: null };
  }

  const amountMinor = parseAmountMinor(amountStr as string, currency as string);
  if (amountMinor === null) {
    return {
      claim: null,
      diagnostics: ["Amount/currency not representable in minor units"],
      headerBlock: null,
    };
  }
  const dueDateDays = parseDueDateDays(dueDate as string);
  if (dueDateDays === null) {
    return {
      claim: null,
      diagnostics: ["Due-Date is not a valid YYYY-MM-DD date"],
      headerBlock: null,
    };
  }

  return {
    claim: {
      invoiceId: invoiceId as string,
      issuerDomain: domain as string,
      amountMinor,
      currency: currency as string,
      dueDateDays,
    },
    diagnostics,
    headerBlock: null,
  };
}

/** Mirrors InvoiceClaimLib hashing: uppercased invoice id, lowercased domain. */
export function previewHashes(claim: InvoiceClaimPreview): {
  invoiceIdHash: `0x${string}`;
  issuerDomainHash: `0x${string}`;
} {
  return {
    invoiceIdHash: keccak256(toBytes(claim.invoiceId.toUpperCase())),
    issuerDomainHash: keccak256(toBytes(claim.issuerDomain.toLowerCase())),
  };
}
