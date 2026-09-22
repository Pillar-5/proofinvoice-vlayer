# ProofInvoice — demo output

Captured from a live run of the deterministic demo (demo mode, no external
services). Reproduce with:

```bash
npm install && npm run contracts:install && npm run contracts:build
npm run build && npm run dev      # or: npm run dev
```

UI screenshot (auto-loads `fixtures/invoice-sample.eml` and parses it):
![ProofInvoice demo UI](screenshot-demo.png)

## 1. Fixture list — `GET /api/fixtures`

```json
{"fixtures":[{"name":"invoice-acme-valid.eml"},{"name":"invoice-malformed.eml"},{"name":"invoice-sample.eml"},{"name":"invoice-second.eml"}]}
```

## 2. Parse — `POST /api/parse` with `invoice-sample.eml`

```json
{
  "claim": {
    "invoiceId": "INV-2026-0001",
    "issuerDomain": "example-supplier.com",
    "amountMinor": "125000",
    "currency": "EUR",
    "dueDateDays": "20503",
    "invoiceIdHash": "0x905373307d597fac2ae5d3a92554b3c2274054f9380f99f337e993c8503d82f…",
    "issuerDomainHash": "0xd3ffbd8a9…"
  },
  "diagnostics": []
}
```

The two hashes are exactly what `InvoiceClaimLib.build` derives on-chain — the
UI preview and the zkEVM prover agree by construction.

## 3. Runtime configuration — `GET /api/config`

```json
{"mode":"demo","network":"anvil","chainId":31337,"vlayerUrl":null,
 "dnsResolverUrl":"https://test-dns.vlayer.xyz","proverAddress":null,
 "verifierAddress":null,"registryAddress":null}
```

## 4. Demo mode refuses to fake proving — `POST /api/proof` → HTTP 409

```json
{"error":"Server is in demo mode (PROOFINVOICE_MODE=demo): real proof
generation and on-chain settlement are disabled. Set PROOFINVOICE_MODE=live
with PROVER_URL and deployed contract addresses to enable them."}
```

This is deliberate: ProofInvoice fails loudly rather than silently substituting
a fake "proof".

## 5. Metrics — `GET /api/metrics`

```json
{
  "proof_attempts": 0,
  "proofs_generated": 0,
  "proofs_failed": 0,
  "onchain_verifications": 0,
  "invoices_verified": 0,
  "issuer_domains": 0,
  "avg_proof_ms": null
}
```

Counters move only when real proofs/settlements happen through the live
pipeline; nothing is fabricated.

## 6. The full live path (requires the vlayer devnet)

With `contracts/compose.yaml` up, anvil running, contracts deployed
(`forge script script/Deploy.s.sol --rpc-url anvil --broadcast`) and
`PROOFINVOICE_MODE=live` in `.env`:

1. `POST /api/proof` → runs `preverifyEmail` (DKIM DNS record + notary
   signature) then `vlayer.prove` on `ProofInvoiceProver.main` — real zk
   proving;
2. `GET /api/proof/:id` until `state: "proved"` (returns the RISC Zero seal +
   call assumptions + the five claim outputs);
3. `POST /api/verify/:id` → `InvoiceVerifier.verifyAndRegister` on-chain
   (re-derives the journal via `onlyVerified`, checks the seal, writes the
   record) → returns tx hash, claim hash, block;
4. `GET /api/metrics` shows the counters incremented.

`npm run test:integration` automates exactly this sequence and asserts the
registry reports the claim as verified on-chain.

## Real testnet deployment (2026-09-21)

Contracts deployed to **Ethereum Sepolia (chain id 11155111)** with
`forge script script/Deploy.s.sol --rpc-url <Alchemy Sepolia RPC> --broadcast`
and verified on-chain afterwards (`cast code`, `cast call` for wiring):

| Contract | Address | Code size |
|---|---|---|
| ProofInvoiceProver | `0xBebf4c83daC02579024f273972aEd796d0086aA1` | 18,807 bytes |
| InvoiceRegistry | `0x7663c39DC4f0a8f3c255B2Da4fa465be0a426514` | 5,641 bytes |
| InvoiceVerifier | `0x0Eef53E811E5e1Cf3E4B61e60Bb539d4d29a10E4` | 8,941 bytes |

Verified wiring on-chain: `InvoiceVerifier.prover()` → deployed Prover,
`InvoiceVerifier.registry()` → deployed Registry, `InvoiceRegistry.verifier()`
→ deployed Verifier.

Deployment transactions:

- Prover: `0xbc1644f3d99513c7ef398b467a6dd2162afc46adf8cda58afe1b7ca7af2415b4`
- Registry: `0x27fc1cbb3daa4037076e65189f5323359308c5725f257ae57d84780d44617da9`
- Verifier: `0x45a663729546a014d9c7d8f7ddcc2495eb3c3c3c0587f56a5af3416602ef34a5`
- Registry→Verifier wiring: `0xe577c26cd80a5ee39574e24a9414914c40380b4f2de66de05bba33b30d97f5f2`

With `CHAIN_NAME=sepolia`, `VLAYER_ENV=testnet`,
`PROVER_URL=https://stable-fake-prover.vlayer.xyz/1.5.1/` and these addresses
in `.env`, `GET /api/config` reports:

```json
{"mode":"live","network":"sepolia","chainId":11155111,
 "proverUrl":"https://stable-fake-prover.vlayer.xyz/1.5.1/",
 "dnsResolverUrl":"https://test-dns.vlayer.xyz",
 "proverAddress":"0xBebf4c83daC02579024f273972aEd796d0086aA1",
 "verifierAddress":"0x0Eef53E811E5e1Cf3E4B61e60Bb539d4d29a10E4",
 "registryAddress":"0x7663c39DC4f0a8f3c255B2Da4fa465be0a426514"}
```

The remaining step for a full end-to-end proof record is a genuinely
DKIM-signed invoice email (see `docs/live-demo.md`); the deterministic
fixtures are unsigned development inputs and are never presented as proofs.

