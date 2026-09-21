// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Script, console} from "forge-std/Script.sol";

import {InvoiceRegistry} from "../src/InvoiceRegistry.sol";
import {ProofInvoiceProver} from "../src/vlayer/ProofInvoiceProver.sol";
import {InvoiceVerifier} from "../src/vlayer/InvoiceVerifier.sol";

/// @notice Deploys the ProofInvoice stack:
///           1. `ProofInvoiceProver`  (runs in the vlayer zkEVM, code lives on-chain)
///           2. `InvoiceRegistry`     (stores verified claim records)
///           3. `InvoiceVerifier`     (vlayer `onlyVerified` entrypoint)
///         and wires the registry to the verifier.
///
/// Usage:
///   forge script script/Deploy.s.sol --rpc-url $JSON_RPC_URL --broadcast
contract DeployProofInvoice is Script {
    function run() external returns (address proverAddress, address registryAddress, address verifierAddress) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address registryOwner = vm.envOr("REGISTRY_OWNER", vm.addr(deployerPrivateKey));

        vm.startBroadcast(deployerPrivateKey);

        ProofInvoiceProver prover = new ProofInvoiceProver();
        InvoiceRegistry registry = new InvoiceRegistry(registryOwner);
        InvoiceVerifier verifier = new InvoiceVerifier(address(prover), registry);

        // The registry accepts writes from exactly one verifier.
        registry.setVerifier(address(verifier));

        vm.stopBroadcast();

        proverAddress = address(prover);
        registryAddress = address(registry);
        verifierAddress = address(verifier);

        console.log("chainId          :", block.chainid);
        console.log("ProofInvoiceProver :", proverAddress);
        console.log("InvoiceRegistry    :", registryAddress);
        console.log("InvoiceVerifier    :", verifierAddress);
        console.log("registry owner     :", registryOwner);
    }
}
