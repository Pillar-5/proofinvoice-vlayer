// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {CallAssumptions} from "vlayer-0.1.0/CallAssumptions.sol";
import {Proof, ProofLib} from "vlayer-0.1.0/Proof.sol";
import {TestHelpers} from "vlayer-test/helpers/TestHelpers.sol";

import {InvoiceClaim} from "../../src/libraries/InvoiceClaim.sol";

/// @notice Builds the `(Proof, journal)` pair that `ProofInvoiceProver.main` would
///         return, so a `Verifier` contract can be exercised without a live prover.
///
/// This mirrors the approach vlayer uses for its own verifier test-suite
/// (vlayer-xyz/vlayer, `contracts/vlayer/test/helpers/TestHelpers.sol`), which is
/// imported here rather than reimplemented. The seal is produced by risc0's
/// `RiscZeroMockVerifier` in FAKE proof mode, i.e. exactly the mode the vlayer devnet
/// prover runs in. It is a *test fixture*, never used by the application.
contract ProofInvoiceProofFixtures {
    TestHelpers private immutable helpers;

    constructor() {
        helpers = new TestHelpers();
    }

    /// @param prover Address the verifier expects as `prover`.
    /// @param selector `ProofInvoiceProver.main.selector`.
    /// @param claim Claim whose ABI encoding becomes the proof's public journal.
    function createClaimProof(address prover, bytes4 selector, InvoiceClaim memory claim)
        external
        view
        returns (Proof memory proof, bytes32 journalHash)
    {
        CallAssumptions memory assumptions =
            CallAssumptions(prover, selector, block.chainid, block.number - 1, blockhash(block.number - 1));

        bytes memory journalParams = abi.encode(
            ProofLib.emptyProof(),
            claim.invoiceIdHash,
            claim.issuerDomainHash,
            claim.amountMinor,
            claim.currency,
            claim.dueDateDays
        );

        return helpers.createProof(assumptions, journalParams);
    }
}
