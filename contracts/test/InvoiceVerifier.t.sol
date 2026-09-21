// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Test} from "forge-std/Test.sol";

import {Proof} from "vlayer-0.1.0/Proof.sol";
import {VerificationFailed} from "risc0-ethereum-3.0.0/src/IRiscZeroVerifier.sol";

import {InvoiceRegistry} from "../src/InvoiceRegistry.sol";
import {InvoiceClaim, InvoiceClaimLib} from "../src/libraries/InvoiceClaim.sol";
import {InvoiceVerifier} from "../src/vlayer/InvoiceVerifier.sol";
import {ProofInvoiceProver} from "../src/vlayer/ProofInvoiceProver.sol";
import {ProofInvoiceProofFixtures} from "./helpers/ProofInvoiceProofFixtures.sol";

/// @notice Exercises the vlayer verification path end to end without a live prover.
///
/// This is the part of the suite that proves the integration is real: the verifier under
/// test is the production `InvoiceVerifier`, the `onlyVerified` modifier is vlayer's, and
/// the seal is verified by risc0's verifier inside `FakeProofVerifier`. The only thing
/// stubbed out is the vlayer server itself, whose output is replicated by vlayer's own
/// `TestHelpers`. That is why these tests belong in the default suite while
/// `vlayer test` (see `test/vlayer/`) covers the zkEVM execution.
contract InvoiceVerifierTest is Test {
    ProofInvoiceProver private prover;
    InvoiceRegistry private registry;
    InvoiceVerifier private verifier;
    ProofInvoiceProofFixtures private fixtures;

    address private constant SUBMITTER = address(0x5013);
    address private constant OWNER = address(0xA11CE);

    function setUp() public {
        vm.roll(1_000); // ensure a historical block exists for the call assumptions

        vm.startPrank(OWNER);
        prover = new ProofInvoiceProver();
        registry = new InvoiceRegistry(OWNER);
        verifier = new InvoiceVerifier(address(prover), registry);
        registry.setVerifier(address(verifier));
        vm.stopPrank();
        fixtures = new ProofInvoiceProofFixtures();
    }

    function _claim() private pure returns (InvoiceClaim memory) {
        return InvoiceClaimLib.build("INV-2026-0001", "billing.example.com", 125_000, bytes3("EUR"), 20_498);
    }

    /// Builds a proof whose public journal encodes `claim`.
    function _proofFor(InvoiceClaim memory claim) private view returns (Proof memory) {
        (Proof memory proof,) = fixtures.createClaimProof(address(prover), ProofInvoiceProver.main.selector, claim);
        return proof;
    }

    function test_validProofRegistersClaim() public {
        InvoiceClaim memory claim = _claim();
        bytes32 claimHash = InvoiceClaimLib.claimHash(claim);
        Proof memory proof = _proofFor(claim);

        vm.prank(SUBMITTER);
        verifier.verifyAndRegister(
            proof, claim.invoiceIdHash, claim.issuerDomainHash, claim.amountMinor, claim.currency, claim.dueDateDays
        );

        assertTrue(registry.isClaimVerified(claimHash));
        assertEq(registry.totalVerified(), 1);

        InvoiceRegistry.InvoiceRecord memory record = registry.recordOf(claimHash);
        assertEq(record.amountMinor, 125_000);
        assertEq(bytes3(record.currency), bytes3("EUR"));
        assertEq(record.dueDateDays, 20_498);
        assertEq(record.submitter, SUBMITTER);
        assertEq(record.verifier, address(verifier));
    }

    /// @dev Tampering with any public input after proving must break the journal digest.
    function test_tamperedPublicInputIsRejected() public {
        InvoiceClaim memory claim = _claim();
        Proof memory proof = _proofFor(claim);

        vm.prank(SUBMITTER);
        vm.expectRevert(VerificationFailed.selector);
        verifier.verifyAndRegister(
            proof,
            claim.invoiceIdHash,
            claim.issuerDomainHash,
            claim.amountMinor + 1, // inflated amount
            claim.currency,
            claim.dueDateDays
        );

        assertEq(registry.totalVerified(), 0);
    }

    /// @dev Swapping the issuer domain for a look-alike must be impossible.
    function test_swappingIssuerDomainIsRejected() public {
        InvoiceClaim memory claim = _claim();
        Proof memory proof = _proofFor(claim);

        vm.prank(SUBMITTER);
        vm.expectRevert(VerificationFailed.selector);
        verifier.verifyAndRegister(
            proof,
            claim.invoiceIdHash,
            keccak256(bytes("attacker.example")),
            claim.amountMinor,
            claim.currency,
            claim.dueDateDays
        );
    }

    /// @dev A proof produced by a different prover contract must not be accepted.
    function test_proofFromDifferentProverIsRejected() public {
        InvoiceClaim memory claim = _claim();

        (Proof memory forged,) = fixtures.createClaimProof(address(0xDEAD), ProofInvoiceProver.main.selector, claim);

        vm.prank(SUBMITTER);
        vm.expectRevert(bytes("Invalid prover"));
        verifier.verifyAndRegister(
            forged, claim.invoiceIdHash, claim.issuerDomainHash, claim.amountMinor, claim.currency, claim.dueDateDays
        );
    }

    /// @dev A proof for a different prover function of the same contract must not be accepted.
    function test_proofForDifferentSelectorIsRejected() public {
        InvoiceClaim memory claim = _claim();

        (Proof memory forged,) = fixtures.createClaimProof(address(prover), bytes4(0x01020304), claim);

        vm.prank(SUBMITTER);
        vm.expectRevert(bytes("Invalid selector"));
        verifier.verifyAndRegister(
            forged, claim.invoiceIdHash, claim.issuerDomainHash, claim.amountMinor, claim.currency, claim.dueDateDays
        );
    }

    /// @dev Re-submitting an identical, still-valid proof must not register twice.
    function test_replayIsRejected() public {
        InvoiceClaim memory claim = _claim();
        Proof memory proof = _proofFor(claim);

        vm.startPrank(SUBMITTER);
        verifier.verifyAndRegister(
            proof, claim.invoiceIdHash, claim.issuerDomainHash, claim.amountMinor, claim.currency, claim.dueDateDays
        );

        vm.expectRevert(
            abi.encodeWithSelector(InvoiceRegistry.ClaimAlreadyVerified.selector, InvoiceClaimLib.claimHash(claim))
        );
        verifier.verifyAndRegister(
            proof, claim.invoiceIdHash, claim.issuerDomainHash, claim.amountMinor, claim.currency, claim.dueDateDays
        );
        vm.stopPrank();

        assertEq(registry.totalVerified(), 1);
    }

    /// @dev A prover that returns an unsupported currency must be stopped at the verifier.
    function test_unsupportedCurrencyFromProverIsRejected() public {
        InvoiceClaim memory claim = _claim();
        claim.currency = bytes3("XXX");
        Proof memory proof = _proofFor(claim);

        vm.prank(SUBMITTER);
        vm.expectRevert(abi.encodeWithSelector(InvoiceClaimLib.UnsupportedCurrency.selector, bytes3("XXX")));
        verifier.verifyAndRegister(
            proof, claim.invoiceIdHash, claim.issuerDomainHash, claim.amountMinor, claim.currency, claim.dueDateDays
        );
    }

    /// @dev A zero-amount claim is malformed and must never reach the registry.
    function test_zeroAmountIsRejected() public {
        InvoiceClaim memory claim = _claim();
        claim.amountMinor = 0;
        Proof memory proof = _proofFor(claim);

        vm.prank(SUBMITTER);
        vm.expectRevert(abi.encodeWithSelector(InvoiceClaimLib.InvalidAmount.selector, "zero amount"));
        verifier.verifyAndRegister(
            proof, claim.invoiceIdHash, claim.issuerDomainHash, claim.amountMinor, claim.currency, claim.dueDateDays
        );
    }

    /// @dev An empty invoice identifier hash is malformed.
    function test_emptyInvoiceIdHashIsRejected() public {
        InvoiceClaim memory claim = _claim();
        claim.invoiceIdHash = bytes32(0);
        Proof memory proof = _proofFor(claim);

        vm.prank(SUBMITTER);
        vm.expectRevert(abi.encodeWithSelector(InvoiceClaimLib.InvalidInvoiceId.selector, "empty invoice hash"));
        verifier.verifyAndRegister(
            proof, claim.invoiceIdHash, claim.issuerDomainHash, claim.amountMinor, claim.currency, claim.dueDateDays
        );
    }

    /// @dev An empty issuer domain hash is malformed.
    function test_emptyIssuerDomainHashIsRejected() public {
        InvoiceClaim memory claim = _claim();
        claim.issuerDomainHash = bytes32(0);
        Proof memory proof = _proofFor(claim);

        vm.prank(SUBMITTER);
        vm.expectRevert(abi.encodeWithSelector(InvoiceClaimLib.InvalidDomain.selector, "empty domain hash"));
        verifier.verifyAndRegister(
            proof, claim.invoiceIdHash, claim.issuerDomainHash, claim.amountMinor, claim.currency, claim.dueDateDays
        );
    }

    function test_constructorRejectsZeroAddresses() public {
        vm.expectRevert(InvoiceVerifier.ZeroAddress.selector);
        new InvoiceVerifier(address(0), registry);

        vm.expectRevert(InvoiceVerifier.ZeroAddress.selector);
        new InvoiceVerifier(address(prover), InvoiceRegistry(address(0)));
    }

    /// @dev Distinct invoices from the same issuer are both registrable.
    function test_twoDistinctInvoicesBothRegister() public {
        InvoiceClaim memory first = _claim();
        InvoiceClaim memory second =
            InvoiceClaimLib.build("INV-2026-0002", "billing.example.com", 4_290, bytes3("USD"), 20_510);

        vm.startPrank(SUBMITTER);
        Proof memory p1 = _proofFor(first);
        verifier.verifyAndRegister(
            p1, first.invoiceIdHash, first.issuerDomainHash, first.amountMinor, first.currency, first.dueDateDays
        );

        Proof memory p2 = _proofFor(second);
        verifier.verifyAndRegister(
            p2, second.invoiceIdHash, second.issuerDomainHash, second.amountMinor, second.currency, second.dueDateDays
        );
        vm.stopPrank();

        assertEq(registry.totalVerified(), 2);
    }
}
