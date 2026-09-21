import type { Abi } from "viem";

/** Mirrors contracts/src/vlayer/ProofInvoiceProver.sol (artifacts from `forge build`). */
export const proofInvoiceProverAbi = [
  {
    type: "function",
    name: "main",
    stateMutability: "view",
    inputs: [
      {
        name: "unverifiedEmail",
        type: "tuple",
        components: [
          { name: "email", internalType: "string", type: "string" },
          {
            name: "dnsRecord",
            internalType: "struct DnsRecord",
            type: "tuple",
            components: [
              { name: "name", internalType: "string", type: "string" },
              { name: "recordType", internalType: "uint8", type: "uint8" },
              { name: "data", internalType: "string", type: "string" },
              { name: "ttl", internalType: "uint64", type: "uint64" },
            ],
          },
          {
            name: "verificationData",
            internalType: "struct UnverifiedEmail.VerificationData",
            type: "tuple",
            components: [
              { name: "validUntil", internalType: "uint64", type: "uint64" },
              { name: "signature", internalType: "bytes", type: "bytes" },
              { name: "pubKey", internalType: "bytes", type: "bytes" },
            ],
          },
        ],
      },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct Proof",
        components: [
          {
            name: "seal",
            type: "tuple",
            internalType: "struct Seal",
            components: [
              { name: "verifierSelector", type: "bytes4", internalType: "bytes4" },
              { name: "seal", type: "bytes32[8]", internalType: "bytes32[8]" },
              { name: "mode", type: "uint8", internalType: "enum ProofMode" },
            ],
          },
          { name: "callGuestId", type: "bytes32", internalType: "bytes32" },
          { name: "length", type: "uint256", internalType: "uint256" },
          {
            name: "callAssumptions",
            type: "tuple",
            internalType: "struct CallAssumptions",
            components: [
              { name: "proverContractAddress", type: "address", internalType: "address" },
              { name: "functionSelector", type: "bytes4", internalType: "bytes4" },
              { name: "settleChainId", type: "uint256", internalType: "uint256" },
              { name: "settleBlockNumber", type: "uint256", internalType: "uint256" },
              { name: "settleBlockHash", type: "bytes32", internalType: "bytes32" },
            ],
          },
        ],
      },
      { name: "invoiceIdHash", type: "bytes32", internalType: "bytes32" },
      { name: "issuerDomainHash", type: "bytes32", internalType: "bytes32" },
      { name: "amountMinor", type: "uint256", internalType: "uint256" },
      { name: "currency", type: "bytes3", internalType: "bytes3" },
      { name: "dueDateDays", type: "uint64", internalType: "uint64" },
    ],
  },
] as const satisfies Abi;

/** Mirrors contracts/src/vlayer/InvoiceVerifier.sol#verifyAndRegister. */
export const invoiceVerifierAbi = [
  {
    type: "function",
    name: "verifyAndRegister",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "proof",
        type: "tuple",
        components: [
          {
            name: "seal",
            type: "tuple",
            internalType: "struct Seal",
            components: [
              { name: "verifierSelector", type: "bytes4", internalType: "bytes4" },
              { name: "seal", type: "bytes32[8]", internalType: "bytes32[8]" },
              { name: "mode", type: "uint8", internalType: "enum ProofMode" },
            ],
          },
          { name: "callGuestId", type: "bytes32", internalType: "bytes32" },
          { name: "length", type: "uint256", internalType: "uint256" },
          {
            name: "callAssumptions",
            type: "tuple",
            internalType: "struct CallAssumptions",
            components: [
              { name: "proverContractAddress", type: "address", internalType: "address" },
              { name: "functionSelector", type: "bytes4", internalType: "bytes4" },
              { name: "settleChainId", type: "uint256", internalType: "uint256" },
              { name: "settleBlockNumber", type: "uint256", internalType: "uint256" },
              { name: "settleBlockHash", type: "bytes32", internalType: "bytes32" },
            ],
          },
        ],
      },
      { name: "invoiceIdHash", type: "bytes32", internalType: "bytes32" },
      { name: "issuerDomainHash", type: "bytes32", internalType: "bytes32" },
      { name: "amountMinor", type: "uint256", internalType: "uint256" },
      { name: "currency", type: "bytes3", internalType: "bytes3" },
      { name: "dueDateDays", type: "uint64", internalType: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "error",
    name: "ZeroAddress",
    inputs: [],
  },
  {
    type: "event",
    name: "InvoiceClaimVerified",
    inputs: [
      { name: "claimHash", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "invoiceIdHash", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "submitter", type: "address", indexed: true, internalType: "address" },
    ],
  },
  {
    type: "function",
    name: "prover",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
  },
  {
    type: "function",
    name: "registry",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
  },
] as const satisfies Abi;

/** Mirrors contracts/src/InvoiceRegistry.sol. */
export const invoiceRegistryAbi = [
  {
    type: "function",
    name: "isClaimVerified",
    stateMutability: "view",
    inputs: [{ name: "claimHash", type: "bytes32", internalType: "bytes32" }],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
  },
  {
    type: "function",
    name: "claimHashOfInvoice",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
  },
  {
    type: "function",
    name: "recordOf",
    stateMutability: "view",
    inputs: [{ name: "claimHash", type: "bytes32", internalType: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct InvoiceRegistry.InvoiceRecord",
        components: [
          { name: "claimHash", type: "bytes32", internalType: "bytes32" },
          { name: "invoiceIdHash", type: "bytes32", internalType: "bytes32" },
          { name: "issuerDomainHash", type: "bytes32", internalType: "bytes32" },
          { name: "amountMinor", type: "uint256", internalType: "uint256" },
          { name: "currency", type: "bytes3", internalType: "bytes3" },
          { name: "dueDateDays", type: "uint64", internalType: "uint64" },
          { name: "verifiedAt", type: "uint64", internalType: "uint64" },
          { name: "verifier", type: "address", internalType: "address" },
          { name: "submitter", type: "address", internalType: "address" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "totalVerified",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
  },
  {
    type: "event",
    name: "InvoiceVerified",
    inputs: [
      { name: "claimHash", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "invoiceIdHash", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "issuerDomainHash", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "amountMinor", type: "uint256", internalType: "uint256" },
      { name: "currency", type: "bytes3", internalType: "bytes3" },
      { name: "dueDateDays", type: "uint64", internalType: "uint64" },
      { name: "verifiedAt", type: "uint64", internalType: "uint64" },
      { name: "verifier", type: "address", internalType: "address" },
      { name: "submitter", type: "address", internalType: "address" },
    ],
  },
] as const satisfies Abi;

