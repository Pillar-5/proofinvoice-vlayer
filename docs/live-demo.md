# Live proof demonstration

This guide walks through a complete, real ProofInvoice run: a DKIM-signed
email, a real vlayer Email Proof, and an on-chain verification transaction on
Ethereum Sepolia.

## 0. Prerequisites

- Node.js ≥ 20, npm, Foundry (`foundryup`), Docker (only for local devnet)
- A wallet with Sepolia ETH (use a dedicated test wallet — never a mainnet key)
- A mailbox on a **DKIM-enabled domain you control** (see §1)

## 1. Prepare the test email

The email must be **genuinely DKIM-signed by the sending domain**. Do not edit
a received email, and do not invent a signature — the DKIM signature covers the
exact bytes of headers and body, and any modification invalidates it.

1. Use a mailbox on a domain with DKIM enabled (e.g. Google Workspace or
   Microsoft 365 with a custom domain, or any provider that signs outgoing
   mail — check that the domain publishes a DKIM TXT record,
   `<selector>._domainkey.<domain>`).
2. Send an invoice email from that mailbox with body fields in the exact
   format the prover extracts (one field per line):

   ```text
   Invoice-ID: INV-2026-001
   Amount: 1250.00
   Currency: GBP
   Due-Date: 2026-09-30
   ```

3. From the **receiving** mailbox, export the original message as `.eml`
   (Gmail: three-dot menu → *Download message*; Outlook/Thunderbird:
   *File → Save As*). The `.eml` must retain all original headers, including
   `DKIM-Signature:`.

Verify the export contains an intact signature:

```bash
grep -c "DKIM-Signature" your-email.eml
```

Note the DKIM constraints enforced by vlayer (see the vlayer book, § Email):

- exactly one DKIM signature whose `d=` tag equals the `From` header domain
- the `From` header must be signed and contain a single `local@domain` address
- no whitespace or content changes of any kind after export

## 2. Configure the environment

```bash
cp .env.example .env
```

Fill in:

```env
PROOFINVOICE_MODE=live
PROVER_URL=https://stable-fake-prover.vlayer.xyz/1.5.1/
DNS_SERVICE_URL=https://test-dns.vlayer.xyz
VLAYER_API_TOKEN=<token from https://dashboard.vlayer.xyz/>
VLAYER_ENV=testnet
CHAIN_NAME=sepolia
JSON_RPC_URL=<your Sepolia RPC, e.g. an Alchemy/Infura endpoint>
PRIVATE_KEY=<dedicated test wallet private key>
PROVER_ADDRESS=<deployed ProofInvoiceProver>
VERIFIER_ADDRESS=<deployed InvoiceVerifier>
REGISTRY_ADDRESS=<deployed InvoiceRegistry>
```

## 3. Deploy the contracts (if you haven't already)

```bash
npm run contracts:install
cd contracts
forge script script/Deploy.s.sol --rpc-url $JSON_RPC_URL --broadcast
```

The script prints the three addresses (Prover, Registry, Verifier) and wires
the registry to the verifier. Copy them into `.env`.

## 4. Run the application

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The status panel should show the configured
vlayer prover, network (`sepolia`), contracts, and wallet.

## 5. Run the flow

1. **Email** — upload your `.eml` (or select a fixture). The parsed sender,
   subject, and invoice claim fields are shown.
2. **Proof** — click *Generate vlayer Proof*. The server runs
   `preverifyEmail` (DKIM + DNS notary) and then a real proving job on the
   configured vlayer prover. Proving can take several minutes.
3. **Verification** — click *Verify On Chain*. The proof is submitted to the
   `InvoiceVerifier`, which checks it with `onlyVerified` and registers the
   claim in the `InvoiceRegistry`.
4. **Result** — the verified claim card shows the on-chain values and a link
   to the transaction on the Sepolia block explorer.

## 6. Inspect the result

- Transaction: `https://sepolia.etherscan.io/tx/<hash>`
- Registry: `https://sepolia.etherscan.io/address/<REGISTRY_ADDRESS>#events`
- The `InvoiceVerified` event carries only the hashed/derived claim — no
  email content.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Error verifying DKIM: signature did not verify` | email was modified after signing, or the wrong DNS record was used |
| DKIM `d` tag ≠ From domain | provider signs with its own domain (e.g. `gappssmtp.com`) — see vlayer book § Email |
| Proving job fails immediately | wrong `VLAYER_API_TOKEN` or prover URL |
| `onlyVerified` reverts on-chain | prover/verifier mismatch (redeploy as a set via `Deploy.s.sol`) |
