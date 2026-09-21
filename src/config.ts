/**
 * Environment configuration with fail-fast validation.
 *
 * Real proving requires VLAYER_URL (the vlayer prover service) plus a
 * settlement chain with deployed contracts. When the app runs with
 * PROOFINVOICE_MODE=demo (the default) it only exposes the parser and the
 * metrics, and any attempt to prove or settle fails loudly instead of
 * silently faking success.
 */

export type AppMode = "demo" | "live";

export interface AppConfig {
  mode: AppMode;
  port: number;
  vlayer: {
    url: string;
    dnsResolverUrl: string;
    token?: string;
    chainId: number;
  };
  chain: {
    rpcUrl: string;
    verifierAddress: `0x${string}` | null;
    registryAddress: `0x${string}` | null;
  };
  wallet: { privateKey?: `0x${string}` };
}

const isSet = (v: string | undefined): boolean => typeof v === "string" && v.length > 0;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const mode: AppMode = (env.PROOFINVOICE_MODE ?? "").toLowerCase() === "live" ? "live" : "demo";

  const vlayerUrl = env.VLAYER_URL ?? "";
  const dnsUrl = env.DNS_SERVICE_URL ?? "https://test-dns.vlayer.xyz";
  const token = isSet(env.VLAYER_API_TOKEN) ? env.VLAYER_API_TOKEN : undefined;

  const jsonRpcUrl = env.JSON_RPC_URL ?? "http://127.0.0.1:8545";

  const hexAddress = (name: string, v: string | undefined): `0x${string}` | null => {
    if (!isSet(v)) return null;
    if (!/^0x[0-9a-fA-F]{40}$/.test(v as string)) {
      throw new Error(`${name} is not a valid 20-byte hex address`);
    }
    return v as `0x${string}`;
  };

  const verifierAddress = hexAddress("VERIFIER_ADDRESS", env.VERIFIER_ADDRESS);
  const registryAddress = hexAddress("REGISTRY_ADDRESS", env.REGISTRY_ADDRESS);
  const privateKey = isSet(env.PRIVATE_KEY) ? (env.PRIVATE_KEY as `0x${string}`) : undefined;

  if (mode === "live") {
    if (!isSet(vlayerUrl)) {
      throw new Error("PROOFINVOICE_MODE=live requires VLAYER_URL (vlayer prover service endpoint)");
    }
    if (verifierAddress === null || registryAddress === null) {
      throw new Error("PROOFINVOICE_MODE=live requires VERIFIER_ADDRESS and REGISTRY_ADDRESS");
    }
    if (!privateKey) {
      throw new Error("PROOFINVOICE_MODE=live requires PRIVATE_KEY (anvil default key is fine for local dev)");
    }
  }

  return {
    mode,
    port: Number.parseInt(env.PORT ?? "3000", 10),
    vlayer: {
      url: vlayerUrl,
      dnsResolverUrl: dnsUrl,
      token,
      chainId: Number.parseInt(env.CHAIN_ID ?? "31337", 10),
    },
    chain: { rpcUrl: jsonRpcUrl, verifierAddress, registryAddress },
    wallet: { privateKey },
  };
}
