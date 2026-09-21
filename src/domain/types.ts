/**
 * Domain types shared across the whole application.
 *
 * `InvoiceClaim` mirrors `contracts/src/libraries/InvoiceClaim.sol` field by
 * field. Keep the two in sync; the verifier contract's ABI is the source of
 * truth for the on-chain representation.
 */

/** Fields extracted from an invoice email, before any hashing. */
export interface InvoiceEmailFields {
  /** Invoice identifier exactly as written in the email (e.g. "INV-2026-0001"). */
  invoiceId: string;
  /** Sender domain taken from the DKIM-authenticated From header (lowercase). */
  issuerDomain: string;
  /** Invoice total in ISO-4217 minor units (e.g. cents). */
  amountMinor: bigint;
  /** ISO-4217 alpha-3 currency code, uppercase. */
  currency: string;
  /** Due date as days since the Unix epoch (UTC). */
  dueDateDays: number;
}

/** Public, hashed claim as returned by the prover and stored on-chain. */
export interface InvoiceClaim {
  invoiceIdHash: `0x${string}`;
  issuerDomainHash: `0x${string}`;
  amountMinor: bigint;
  currency: `0x${string}`; // bytes3, right-aligned ASCII, e.g. 0x455552 == "EUR"
  dueDateDays: number;
}

/** Result of parsing an .eml source with postal-mime. */
export interface ParsedEmail {
  /** DKIM-authenticated From mailbox (bare address, e.g. billing@example.com). */
  from: string;
  domain: string;
  subject: string;
  messageId: string;
  date: string;
  textBody: string;
  htmlBody: string;
  /** Canonical ProofInvoice/1 header values (header name lowercased). */
  headers: Record<string, string>;
  /** Lowercased, de-duplicated DKIM signing domains found in the message. */
  dkimDomains: string[];
}

/** A demo invoice sample exposed by the UI. */
export interface InvoiceSample {
  id: string;
  file: string;
  name: string;
  description: string;
}

export type ProofStage = "idle" | "preverify" | "proving" | "done" | "failed";

export interface ProofBundle {
  /** server-assigned id for this proof attempt */
  id: string;
  stage: ProofStage;
  createdAt: string;
  /** ms from request start to finished proof */
  durationMs: number;
  /** preverify + proving metadata */
  preverify: {
    dnsRecord: string;
    validUntil: string;
    dkimDomain: string;
  };
  proving: {
    hash: string;
    chainId: number;
    proverContract: string;
    functionName: string;
    state: string;
    metrics?: {
      gas: number;
      cycles: number;
      times: { preflight: number; proving: number };
    };
  };
  /** The public journal returned by the prover (already the hashed claim). */
  claim: InvoiceClaim;
  /** Human-readable claim for the UI. */
  readable: InvoiceEmailFields;
  /** vlayer Proof object (seal + call assumptions) needed for on-chain verify. */
  proof: unknown;
  /** Raw evm_call_result hex returned by the prover. */
  evmCallResult: string;
}
