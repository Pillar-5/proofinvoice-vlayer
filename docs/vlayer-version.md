# vlayer version audit

**Date:** 2026-09-21
**Repository version used:** `@vlayer/sdk@1.5.1` (npm), vlayer Solidity contracts `v1.5.1` (official `vlayer.zip` release asset, SHA-256 pinned in `scripts/fetch-vlayer-contracts.mjs`)

## Is v1.5.1 still the right version for Email Proofs?

**Yes.** Findings from the current official sources:

1. The `vlayer-xyz/vlayer` GitHub repository carries an archive notice:

   > ⚠️ This Repository is Archived. This repository contains vlayer v1.0, which is no longer actively maintained. We've moved to vlayer 2.0 - a rebuilt protocol focused on cryptographic proofs for real-world data verification.

2. vlayer 2.0 (docs.vlayer.xyz, vlayer.xyz) is a rebuilt protocol centred on **Web Proofs (zkTLS)** and the **Vouch** product. **Email Proofs are not part of the v2.0 surface.** The v2.0 documentation contains no `preverifyEmail`, no Email Proof `Prover`/`Verifier` pattern, and no `EmailProofLib`.

3. The authoritative Email Proof documentation remains the v1.x book at `book.vlayer.xyz` (§ features/email, § javascript/email-proofs, § getting-started/dev-and-production), and the latest stable Email Proof SDK release on npm is **`@vlayer/sdk@1.5.1`** (the npm `latest` dist-tag points at a 1.5.1 nightly; `1.5.1` is the newest non-nightly release).

4. The official v1.5.1 examples (e.g. `examples/simple-email-proof`) pin exactly this stack: `@vlayer/sdk` v1.5.1, soldeer-installed `vlayer-0.1.0` Solidity contracts from the `v1.5.1` release, solc 0.8.28.

**Conclusion:** for Email Proofs, v1.5.1 *is* the current supported implementation. **No migration is possible or required** — upgrading to 2.0 would mean losing the Email Proof feature entirely.

## Verified against official docs (book.vlayer.xyz)

| Area | Official current pattern | ProofInvoice implementation |
|---|---|---|
| Email preverification | `preverifyEmail({ mimeEmail, dnsResolverUrl, token })` from `@vlayer/sdk` | `src/vlayer/client.ts` |
| Proving | `createVlayerClient()` → `prove({ address, proverAbi, functionName, args, chainId })` → `waitForProvingResult({ hash })` | `src/vlayer/client.ts` |
| Prover contract | `Prover` base, `UnverifiedEmail.verify()` (DKIM inside zkEVM), `proof()` placeholder, public return values = journal | `contracts/src/vlayer/ProofInvoiceProver.sol` |
| Verifier contract | `Verifier` base + `onlyVerified(prover, selector)` modifier; first param `Proof calldata`, then the prover's return values | `contracts/src/vlayer/InvoiceVerifier.sol` |
| Regex helpers | `RegexLib` `capture()` (Rust `regex` syntax) | used for claim extraction |
| Solidity import | `vlayer-0.1.0/...` remapping to the release `vlayer.zip` | `contracts/remappings.txt` |

## Environment variables (official names, from `@vlayer/sdk/config` and the book)

- `PROVER_URL` — prover endpoint. Hosted testnet: `https://stable-fake-prover.vlayer.xyz/1.5.1/`
- `DNS_SERVICE_URL` — DoH resolver for DKIM lookups. Hosted testnet: `https://test-dns.vlayer.xyz`
- `VLAYER_API_TOKEN` — token from `https://dashboard.vlayer.xyz/` (hosted environments)
- `VLAYER_ENV` — `dev` | `testnet` | `mainnet`
- `CHAIN_NAME` — settlement chain (e.g. `sepolia`); chain id is derived, never set separately
- `JSON_RPC_URL` — EVM RPC for settlement/deployment

## Testnet support for Email Proofs (official table, `dev-and-production.md`)

Testnet prover runs in **`FAKE` mode** (executes and checks the computation without producing a full SNARK; the documented development mode, test-chains only). Email/web proofs are supported on, among others:

| chain name | email/web |
|---|---|
| `sepolia` | ✅ |
| `baseSepolia` | ✅ |
| `optimismSepolia` | ✅ |

**ProofInvoice uses `sepolia` (Ethereum Sepolia, chain id 11155111).**

## Summary

- Version: `@vlayer/sdk@1.5.1` + vlayer Solidity `v1.5.1` — **current for Email Proofs; no migration needed.**
- Migration to v2.0 is not applicable until Email Proofs exist there; this document should be revisited if vlayer announces Email Proof support in 2.0.
