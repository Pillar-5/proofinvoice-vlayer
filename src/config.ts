/**
 * Environment configuration with fail-fast validation.
 *
 * The vlayer variable names are the official ones declared by the
 * `envSchema` in `@vlayer/sdk/config`: `PROVER_URL`, `DNS_SERVICE_URL`,
 * `VLAYER_API_TOKEN`, `VLAYER_ENV`, `CHAIN_NAME` and `JSON_RPC_URL`.
 *
 * Real proving additionally needs a settlement chain with deployed contracts.
 * When the app runs with PROOFINVOICE_MODE=demo (the default) it only exposes
 * the parser and the metrics, and any attempt to prove or settle fails loudly
 * instead of silently faking success.
 */

import { chainIdOf, resolveChainName, type ChainName } from "./vlayer/chains.js";

export type AppMode = "demo" | "live";

export interface AppConfig {
  mode: AppMode;
  port: number;
  vlayer: {
    /** vlayer prover service endpoint (`PROVER_URL`). */
    url: string;
    /** DNS-over-HTTPS resolver used for DKIM lookups (`DNS_SERVICE_URL`). */
    dnsResolverUrl: string;
    /** Optional vlayer API token (`VLAYER_API_TOKEN`) for hosted networks. */
    token?: string;
    /** vlayer environment selector (`VLAYER_ENV`). */
    env: string;
    /** Settlement chain name (`CHAIN_NAME`). */
    chainName: ChainName;
    /** Chain id derived from `CHAIN_NAME`; never configured separately. */
    chainId: number;
  };
  chain: {
    rpcUrl: string;
    /** vlayer Prover contract to prove against (`PROVER_ADDRESS`). */
    proverAddress: `0x${string}` | null;
    verifierAddress: `0x${string}` | null;
    registryAddress: `0x${string}` | null;
  };
  wallet: { privateKey?: `0x${string}` };
}

const isSet = (v: string | undefined): boolean => typeof v === "string" && v.length > 0;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const mode: AppMode = (env.PROOFINVOICE_MODE ?? "").toLowerCase() === "live" ? "live" : "demo";

  const proverUrl = env.PROVER_URL ?? "";
  const dnsUrl = env.DNS_SERVICE_URL ?? "https://test-dns.vlayer.xyz";
  const token = isSet(env.VLAYER_API_TOKEN) ? env.VLAYER_API_TOKEN : undefined;
  const vlayerEnv = env.VLAYER_ENV ?? "dev";

  // CHAIN_NAME is the single source of truth; the numeric chain id is derived so
  // the proving request and the settlement client can never disagree.
  const chainName = resolveChainName(env.CHAIN_NAME ?? "anvil");
  const chainId = chainIdOf(chainName);

  const jsonRpcUrl = env.JSON_RPC_URL ?? "http://127.0.0.1:8545";

  const hexAddress = (name: string, v: string | undefined): `0x${string}` | null => {
    if (!isSet(v)) return null;
    if (!/^0x[0-9a-fA-F]{40}$/.test(v as string)) {
      throw new Error(`${name} is not a valid 20-byte hex address`);
    }
    return v as `0x${string}`;
  };

  const proverAddress = hexAddress("PROVER_ADDRESS", env.PROVER_ADDRESS);
  const verifierAddress = hexAddress("VERIFIER_ADDRESS", env.VERIFIER_ADDRESS);
  const registryAddress = hexAddress("REGISTRY_ADDRESS", env.REGISTRY_ADDRESS);
  const privateKey = isSet(env.PRIVATE_KEY) ? (env.PRIVATE_KEY as `0x${string}`) : undefined;

  if (mode === "live") {
    if (!isSet(proverUrl)) {
      throw new Error(
        "PROOFINVOICE_MODE=live requires PROVER_URL (the vlayer prover service endpoint, " +
          "e.g. http://127.0.0.1:3000 for the local devnet)",
      );
    }
    if (proverAddress === null || verifierAddress === null || registryAddress === null) {
      throw new Error("PROOFINVOICE_MODE=live requires PROVER_ADDRESS, VERIFIER_ADDRESS and REGISTRY_ADDRESS");
    }
    if (!privateKey) {
      throw new Error("PROOFINVOICE_MODE=live requires PRIVATE_KEY (anvil default key is fine for local dev)");
    }
  }

  return {
    mode,
    port: Number.parseInt(env.PORT ?? "3000", 10),
    vlayer: {
      url: proverUrl,
      dnsResolverUrl: dnsUrl,
      token,
      env: vlayerEnv,
      chainName,
      chainId,
    },
    chain: { rpcUrl: jsonRpcUrl, proverAddress, verifierAddress, registryAddress },
    wallet: { privateKey },
  };
}
