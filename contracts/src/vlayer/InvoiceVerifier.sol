// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Proof} from "vlayer-0.1.0/Proof.sol";
import {Verifier} from "vlayer-0.1.0/Verifier.sol";

import {InvoiceRegistry} from "../InvoiceRegistry.sol";
import {InvoiceClaim, InvoiceClaimLib} from "../libraries/InvoiceClaim.sol";
import {ProofInvoiceProver} from "./ProofInvoiceProver.sol";

/// @title InvoiceVerifier
/// @notice On-chain verification function for ProofInvoice claims.
///
/// `onlyVerified(prover, ProofInvoiceProver.main.selector)` makes vlayer read the
/// submitted `Proof` out of `msg.data`, rebuild the journal digest from the arguments
/// that follow it and check both against the proof seal. Consequences that matter for
/// this product:
///   * the claim arguments cannot be swapped after proving (the digest would change);
///   * the proof must have been produced by *this* prover contract and *this* function;
///   * a full, unmodified private email is never needed on-chain, only the claim.
contract InvoiceVerifier is Verifier {
    /// @notice The vlayer Prover contract whose `main` function may produce claims.
    address public immutable prover;
    /// @notice Registry that stores the accepted claims.
    InvoiceRegistry public immutable registry;

    event InvoiceClaimVerified(bytes32 indexed claimHash, bytes32 indexed invoiceIdHash, address indexed submitter);

    error ZeroAddress();

    constructor(address proverContract, InvoiceRegistry registryContract) {
        if (proverContract == address(0) || address(registryContract) == address(0)) revert ZeroAddress();
        prover = proverContract;
        registry = registryContract;
    }

    /// @notice Verifies a vlayer Email Proof and records the resulting invoice claim.
    /// @dev Argument order and types must mirror `ProofInvoiceProver.main`'s return
    ///      values exactly (Proof first, then every public output in order).
    /// @param amountMinor Invoice total in ISO-4217 minor units.
    /// @param currency ISO-4217 alpha-3 code.
    /// @param dueDateDays Due date as days since the Unix epoch (UTC).
    function verifyAndRegister(
        Proof calldata,
        bytes32 invoiceIdHash,
        bytes32 issuerDomainHash,
        uint256 amountMinor,
        bytes3 currency,
        uint64 dueDateDays
    ) external onlyVerified(prover, ProofInvoiceProver.main.selector) {
        InvoiceClaim memory claim = InvoiceClaim({
            invoiceIdHash: invoiceIdHash,
            issuerDomainHash: issuerDomainHash,
            amountMinor: amountMinor,
            currency: currency,
            dueDateDays: dueDateDays
        });

        // Defence in depth. These values are already cryptographically bound to the
        // proof, but re-validating them keeps the registry's invariants independent of
        // what any future prover version chooses to return.
        if (!InvoiceClaimLib.isSupportedCurrency(currency)) {
            revert InvoiceClaimLib.UnsupportedCurrency(currency);
        }
        if (amountMinor == 0) revert InvoiceClaimLib.InvalidAmount("zero amount");
        if (invoiceIdHash == bytes32(0)) revert InvoiceClaimLib.InvalidInvoiceId("empty invoice hash");
        if (issuerDomainHash == bytes32(0)) revert InvoiceClaimLib.InvalidDomain("empty domain hash");

        // Emit before the registry call so the verification log is always ordered before
        // the registry's own `InvoiceVerified` log, regardless of registry behaviour.
        emit InvoiceClaimVerified(InvoiceClaimLib.claimHash(claim), invoiceIdHash, msg.sender);

        registry.register(claim, msg.sender);
    }
}
