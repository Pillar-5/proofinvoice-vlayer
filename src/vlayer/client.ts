import { createVlayerClient, preverifyEmail } from "@vlayer/sdk";
import type { Proof } from "@vlayer/sdk";
import type { UnverifiedEmail } from "../email/types.js";
import { proofInvoiceProverAbi } from "./abi.js";

/**
 * Thin wrapper around the official `@vlayer/sdk` (v1.5.1) Email Proof flow.
 *
 * The two-step pattern is the one documented at
 * https://docs.vlayer.xyz/products/email/quickstart:
 *   1. `preverifyEmail`  - fetches the sender's DKIM DNS record and the DNS
 *      notary signature, producing the `UnverifiedEmail` prover input;
 *   2. `client.prove` + `waitForProvingResult` - runs `main` inside the vlayer
 *      zkEVM and returns the proof plus the public claim outputs.
 *
 * No part of this module simulates anything: if the prover endpoint or DNS
 * resolver is unreachable the error propagates to the caller.
 */

export interface VlayerConfig {
  /** vlayer prover service URL (VLAYER_URL). */
  proverUrl: string;
  /** DNS-over-HTTPS resolver used for DKIM record lookups (DNS_SERVICE_URL). */
  dnsResolverUrl: string;
  /** Optional vlayer API token (VLAYER_API_TOKEN). */
  token?: string;
  /** Chain the proof is settled for (defaults to the prover's default). */
  chainId?: number;
}

export interface EmailProofResult {
  proof: Proof;
  invoiceIdHash: `0x${string}`;
  issuerDomainHash: `0x${string}`;
  amountMinor: bigint;
  currency: `0x${string}`;
  dueDateDays: bigint;
  /** Server-reported proving metrics, when the prover provides them. */
  metrics?: { provingMs?: number; cycles?: number; vgas?: number };
}

export async function generateEmailProof(
  config: VlayerConfig,
  unverifiedEmail: UnverifiedEmail,
): Promise<EmailProofResult> {
  const preverified = await preverifyEmail({
    mimeEmail: unverifiedEmail.mimeEmail,
    dnsResolverUrl: config.dnsResolverUrl,
    token: config.token,
  });

  const client = createVlayerClient({ url: config.proverUrl, token: config.token });

  const hash = await client.prove({
    address: unverifiedEmail.proverAddress,
    proverAbi: proofInvoiceProverAbi,
    functionName: "main",
    chainId: config.chainId,
    args: [
      {
        email: preverified.email,
        dnsRecord: {
          name: preverified.dnsRecord.name,
          recordType: Number(preverified.dnsRecord.recordType),
          data: preverified.dnsRecord.data,
          ttl: preverified.dnsRecord.ttl,
        },
        verificationData: {
          validUntil: preverified.verificationData.validUntil,
          signature: preverified.verificationData.signature,
          pubKey: preverified.verificationData.pubKey,
        },
      },
    ],
  });

  const result = await client.waitForProvingResult({ hash });

  // `waitForProvingResult` returns the prover's return values in order:
  // Proof, invoiceIdHash, issuerDomainHash, amountMinor, currency, dueDateDays.
  const [proof, invoiceIdHash, issuerDomainHash, amountMinor, currency, dueDateDays] = result as [
    Proof,
    `0x${string}`,
    `0x${string}`,
    bigint,
    `0x${string}`,
    bigint,
  ];

  return {
    proof,
    invoiceIdHash,
    issuerDomainHash,
    amountMinor,
    currency,
    dueDateDays,
  };
}
