# Security and trust model

This document describes exactly what ProofInvoice verifies, what it deliberately
exposes on-chain, and where its guarantees end. It is intentionally factual and
complete; the README only summarises it.

## What is cryptographically verified

1. **Email authenticity (DKIM).** The vlayer prover checks, inside the zkEVM,
   that the email's `DKIM-Signature` validates against the public key published
   in the DNS TXT record of the signer's domain (`d` tag). A modified body,
   modified signed headers, or a wrong/expired DNS record makes proving fail.
2. **Sender domain binding.** The issuer domain in the claim is extracted from
   the DKIM-authenticated `From` header — never from the email body.
3. **Claim content.** The invoice fields (invoice ID, amount, currency, due
   date) are extracted by regex from the authenticated body inside the prover.
   Only the extracted, normalised claim values are published in the proof
   journal; the on-chain verifier re-derives their digest via `onlyVerified`,
   so the claim arguments cannot be swapped after proving.
4. **Proof validity.** The `InvoiceVerifier` contract accepts a claim only when
   the accompanying proof was produced by *its* configured prover contract and
   *its* `main` function, checked against the proof seal.
5. **Non-replay.** The registry records the claim hash and invoice-id hash and
   rejects a second registration of either.

## What is on-chain

Only derived, minimal values:

| Field | Representation |
|---|---|
| invoice ID | keccak256 hash (upper-cased) |
| issuer domain | keccak256 hash (lower-cased) |
| amount | uint256 in ISO-4217 minor units |
| currency | bytes3 (alpha-3 code) |
| due date | uint64 days since Unix epoch |
| claim identity | keccak256 of the packed claim |
| metadata | verifier address, block timestamp |

No raw email content, headers, subject, recipient address, or personal
information is stored on-chain or emitted in events.

## Trust assumptions and limitations

- **Account compromise.** DKIM proves the sending *server* authorised the
  message at send time. It does not prove the human mailbox was not
  compromised, nor that the message reflects agreement of both parties.
- **Invoice semantics.** The proof verifies that the claim fields *exist in an
  authenticated email*. It does not prove the goods/services were delivered,
  that the amount is commercially correct, or that a debt is legally owed.
  ProofInvoice is not a credit assessment and not a payment processor.
- **Email infrastructure.** Email proofs are only as trustworthy as the
  sending mail server and DKIM key management of the issuer domain (see the
  vlayer security discussion in the vlayer book, § Email → Security
  Assumptions).
- **Testnet prover mode.** The public vlayer testnet prover runs in the
  documented `FAKE` mode: proofs execute and are checked, but this mode is for
  development and is not resistant to a malicious prover. Production use
  requires a `GROTH16` prover (mainnet service or self-hosted).
- **Key handling.** The application requires a wallet private key only to send
  the verification transaction. Keys live exclusively in the local `.env`
  (git-ignored). ProofInvoice never asks for email passwords, mailbox access,
  cookies, or seed phrases. It reads a user-supplied `.eml` file only.
- **Contract access control.** The registry accepts writes only from a single
  configured verifier address; the verifier trusts only its configured prover.
  Registry ownership (allowlist management) is a plain owner address.

## Reporting issues

Open a GitHub issue in this repository.
