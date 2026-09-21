import { defineChain, type Chain } from "viem";

/**
 * Chain registry for settlement targets.
 *
 * `CHAIN_NAME` is one of the official vlayer environment variables (see the
 * `envSchema` exported by `@vlayer/sdk/config`), so the accepted names here
 * mirror the `[rpc_endpoints]` aliases in contracts/foundry.toml. `anvil` is the
 * vlayer devnet (chain id 31337); the others are the documented vlayer test
 * environments.
 *
 * `CHAIN_NAME` is the single source of truth for the settlement chain: the
 * numeric chain id submitted alongside a proving request is derived from it via
 * `chainIdOf`, so the two can never drift apart.
 */

export type ChainName = "anvil" | "sepolia" | "base-sepolia" | "optimism-sepolia" | "arbitrum-sepolia";

function makeChains(): Record<ChainName, Chain> {
  return {
    anvil: defineChain({
      id: 31_337,
      name: "anvil",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
    }),
    sepolia: defineChain({
      id: 11_155_111,
      name: "sepolia",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: ["https://eth-sepolia.public.blastapi.io"] } },
      blockExplorers: { default: { name: "Etherscan", url: "https://sepolia.etherscan.io" } },
    }),
    "base-sepolia": defineChain({
      id: 84_532,
      name: "base-sepolia",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: ["https://sepolia.base.org"] } },
      blockExplorers: { default: { name: "Basescan", url: "https://sepolia.basescan.org" } },
    }),
    "optimism-sepolia": defineChain({
      id: 111_554_20,
      name: "optimism-sepolia",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: ["https://sepolia.optimism.io"] } },
      blockExplorers: { default: { name: "Blockscout", url: "https://optimism-sepolia.blockscout.com" } },
    }),
    "arbitrum-sepolia": defineChain({
      id: 421_614,
      name: "arbitrum-sepolia",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: ["https://sepolia-rollup.arbitrum.io/rpc"] } },
      blockExplorers: { default: { name: "Arbiscan", url: "https://sepolia.arbiscan.io" } },
    }),
  };
}

const CHAINS: Record<ChainName, Chain> = makeChains();

export const CHAIN_NAMES = Object.keys(CHAINS) as ChainName[];

/** Validates a `CHAIN_NAME` value, failing loudly with the supported set. */
export function resolveChainName(value: string): ChainName {
  const name = value.toLowerCase() as ChainName;
  if (!CHAIN_NAMES.includes(name)) {
    throw new Error(
      `unsupported CHAIN_NAME '${value}'. Supported: ${CHAIN_NAMES.join(", ")}. ` +
        "Add new chains in src/vlayer/chains.ts and contracts/foundry.toml.",
    );
  }
  return name;
}

/** The viem chain definition for a settlement target. */
export function createChain(name: ChainName): Chain {
  return CHAINS[name];
}

/** The EIP-155 chain id for a settlement target. */
export function chainIdOf(name: ChainName): number {
  return CHAINS[name].id;
}

