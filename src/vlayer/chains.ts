import { defineChain } from "viem";

/**
 * Chain registry for settlement targets. Names mirror the `[rpc_endpoints]`
 * aliases in contracts/foundry.toml. Anvil is the vlayer devnet target; the
 * testnets are the documented vlayer test environments.
 */

export type ChainName = "anvil" | "sepolia" | "base-sepolia" | "optimism-sepolia" | "arbitrum-sepolia";

export function resolveChainName(value: string): ChainName {
  const name = value.toLowerCase() as ChainName;
  const known: ChainName[] = ["anvil", "sepolia", "base-sepolia", "optimism-sepolia", "arbitrum-sepolia"];
  if (!known.includes(name)) {
    throw new Error(
      `unsupported CHAIN_NAME '${value}'. Supported: ${known.join(", ")}. ` +
        "Add new chains in src/vlayer/chains.ts and contracts/foundry.toml.",
    );
  }
  return name;
}

export function createChain(name: ChainName): ReturnType<typeof defineChain> {
  switch (name) {
    case "anvil":
      return defineChain({
        id: 31_337,
        name: "anvil",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
      });
    case "sepolia":
      return defineChain({
        id: 11_155_111,
        name: "sepolia",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: ["https://eth-sepolia.public.blastapi.io"] } },
        blockExplorers: { default: { name: "Etherscan", url: "https://sepolia.etherscan.io" } },
      });
    case "base-sepolia":
      return defineChain({
        id: 84_532,
        name: "base-sepolia",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: ["https://sepolia.base.org"] } },
        blockExplorers: { default: { name: "Basescan", url: "https://sepolia.basescan.org" } },
      });
    case "optimism-sepolia":
      return defineChain({
        id: 111_554_20,
        name: "optimism-sepolia",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: ["https://sepolia.optimism.io"] } },
        blockExplorers: { default: { name: "Blockscout", url: "https://optimism-sepolia.blockscout.com" } },
      });
    case "arbitrum-sepolia":
      return defineChain({
        id: 421_614,
        name: "arbitrum-sepolia",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: ["https://sepolia-rollup.arbitrum.io/rpc"] } },
        blockExplorers: { default: { name: "Arbiscan", url: "https://sepolia.arbiscan.io" } },
      });
  }
}
