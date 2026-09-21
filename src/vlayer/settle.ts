import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type PublicActions,
  type WalletActions,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Proof } from "@vlayer/sdk";
import { invoiceVerifierAbi, invoiceRegistryAbi } from "./abi.js";
import type { InvoiceClaimPreview } from "../email/claims.js";
import type { EmailProofResult } from "./client.js";

/**
 * On-chain settlement of a vlayer Email Proof.
 *
 * Calls `InvoiceVerifier.verifyAndRegister(proof, ...)` with the exact public
 * outputs returned by the prover. The contract re-derives the journal digest
 * via `onlyVerified`, checks the RISC Zero seal and only then writes the claim
 * into `InvoiceRegistry`. Any tampering with the claim between proving and
 * settlement changes the digest and reverts.
 */

export interface ChainConfig {
  viemChain: Chain;
  rpcUrl: string;
  verifierAddress: Address;
  registryAddress: Address;
  account: ReturnType<typeof privateKeyToAccount>;
}

export interface SettlementResult {
  txHash: `0x${string}`;
  claimHash: `0x${string}`;
  verifiedAt: bigint;
  blockNumber: bigint;
  gasUsed: bigint;
}

export function createChainClients(config: ChainConfig): {
  publicClient: PublicActions & { chain: Chain };
  walletClient: WalletActions & { chain: Chain };
} {
  const publicClient = createPublicClient({ chain: config.viemChain, transport: http(config.rpcUrl) });
  const walletClient = createWalletClient({
    chain: config.viemChain,
    transport: http(config.rpcUrl),
    account: config.account,
  });
  return { publicClient, walletClient };
}

/** Submits the proof to the on-chain verifier and waits for the receipt. */
export async function settleProofOnChain(
  config: ChainConfig,
  emailResult: EmailProofResult,
  _claim: InvoiceClaimPreview, // parsed locally for UX symmetry; only the proof's own outputs are submitted
): Promise<SettlementResult> {
  const { publicClient, walletClient } = createChainClients(config);

  const { request } = await publicClient.simulateContract({
    address: config.verifierAddress,
    abi: invoiceVerifierAbi,
    functionName: "verifyAndRegister",
    account: config.account,
    args: [
      emailResult.proof,
      emailResult.invoiceIdHash,
      emailResult.issuerDomainHash,
      emailResult.amountMinor,
      emailResult.currency,
      emailResult.dueDateDays,
    ],
  });

  const txHash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`verifyAndRegister reverted on-chain (tx ${txHash})`);
  }

  // The registry derives the claimHash from the claim; recompute it exactly as
  // InvoiceClaimLib does so the caller gets the canonical id.
  const claimHash = await publicClient.readContract({
    address: config.registryAddress,
    abi: invoiceRegistryAbi,
    functionName: "claimHashOfInvoice",
    args: [emailResult.invoiceIdHash],
  });

  const record = await publicClient.readContract({
    address: config.registryAddress,
    abi: invoiceRegistryAbi,
    functionName: "recordOf",
    args: [claimHash],
  });

  return {
    txHash,
    claimHash,
    verifiedAt: record.verifiedAt,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
  };
}
