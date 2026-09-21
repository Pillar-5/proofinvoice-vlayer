// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Test} from "forge-std/Test.sol";

import {InvoiceRegistry} from "../src/InvoiceRegistry.sol";
import {InvoiceClaim, InvoiceClaimLib} from "../src/libraries/InvoiceClaim.sol";

contract InvoiceRegistryTest is Test {
    InvoiceRegistry private registry;
    address private constant OWNER = address(0xA11CE);
    address private constant VERIFIER = address(0xF1E1D);
    address private constant SUBMITTER = address(0x5B);

    event InvoiceVerified(
        bytes32 indexed claimHash,
        bytes32 indexed invoiceIdHash,
        bytes32 indexed issuerDomainHash,
        uint256 amountMinor,
        bytes3 currency,
        uint64 dueDateDays,
        uint64 verifiedAt,
        address verifier,
        address submitter
    );

    event VerifierUpdated(address indexed previousVerifier, address indexed newVerifier);

    function setUp() public {
        registry = new InvoiceRegistry(OWNER);
        vm.prank(OWNER);
        registry.setVerifier(VERIFIER);
    }

    function _claim(string memory invoiceId) private pure returns (InvoiceClaim memory) {
        return InvoiceClaimLib.build(invoiceId, "billing.example.com", 125_000, bytes3("EUR"), 20_498);
    }

    function test_constructorRejectsZeroOwner() public {
        vm.expectRevert(InvoiceRegistry.ZeroAddress.selector);
        new InvoiceRegistry(address(0));
    }

    function test_setVerifierEmitsAndIsOneShot() public {
        InvoiceRegistry fresh = new InvoiceRegistry(OWNER);
        vm.expectEmit(true, true, false, true);
        emit VerifierUpdated(address(0), VERIFIER);
        vm.prank(OWNER);
        fresh.setVerifier(VERIFIER);

        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(InvoiceRegistry.VerifierAlreadySet.selector, VERIFIER));
        fresh.setVerifier(address(0xBAD));
    }

    function test_setVerifierOnlyOwner() public {
        InvoiceRegistry fresh = new InvoiceRegistry(OWNER);
        vm.prank(address(0xBAD));
        vm.expectRevert(abi.encodeWithSelector(InvoiceRegistry.NotOwner.selector, address(0xBAD)));
        fresh.setVerifier(VERIFIER);
    }

    function test_registerOnlyVerifier() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(abi.encodeWithSelector(InvoiceRegistry.NotVerifier.selector, address(0xBAD)));
        registry.register(_claim("INV-2026-0001"), SUBMITTER);
    }

    function test_registerStoresRecordAndEmitsEvent() public {
        InvoiceClaim memory claim = _claim("INV-2026-0001");
        bytes32 claimHash = InvoiceClaimLib.claimHash(claim);

        vm.warp(1_772_000_000);
        vm.expectEmit(true, true, true, true);
        emit InvoiceVerified(
            claimHash,
            claim.invoiceIdHash,
            claim.issuerDomainHash,
            claim.amountMinor,
            claim.currency,
            claim.dueDateDays,
            uint64(block.timestamp),
            VERIFIER,
            SUBMITTER
        );
        vm.prank(VERIFIER);
        registry.register(claim, SUBMITTER);

        InvoiceRegistry.InvoiceRecord memory record = registry.recordOf(claimHash);
        assertEq(record.claimHash, claimHash);
        assertEq(record.invoiceIdHash, claim.invoiceIdHash);
        assertEq(record.issuerDomainHash, claim.issuerDomainHash);
        assertEq(record.amountMinor, 125_000);
        assertEq(bytes3(record.currency), bytes3("EUR"));
        assertEq(record.dueDateDays, 20_498);
        assertEq(record.verifiedAt, uint64(block.timestamp));
        assertEq(record.verifier, VERIFIER);
        assertEq(record.submitter, SUBMITTER);
        assertEq(registry.totalVerified(), 1);
        assertTrue(registry.isClaimVerified(claimHash));
    }

    function test_registerRejectsReplayOfSameClaim() public {
        InvoiceClaim memory claim = _claim("INV-2026-0001");
        bytes32 claimHash = InvoiceClaimLib.claimHash(claim);

        vm.startPrank(VERIFIER);
        registry.register(claim, SUBMITTER);
        vm.expectRevert(abi.encodeWithSelector(InvoiceRegistry.ClaimAlreadyVerified.selector, claimHash));
        registry.register(claim, SUBMITTER);
        vm.stopPrank();

        assertEq(registry.totalVerified(), 1);
    }

    function test_registerRejectsSecondClaimForSameInvoiceId() public {
        InvoiceClaim memory first = _claim("INV-2026-0001");

        // Same invoice identifier, different amount: a conflicting re-issuance.
        InvoiceClaim memory conflicting =
            InvoiceClaimLib.build("inv-2026-0001", "billing.example.com", 999_900, bytes3("EUR"), 20_498);

        vm.startPrank(VERIFIER);
        registry.register(first, SUBMITTER);
        vm.expectRevert(
            abi.encodeWithSelector(
                InvoiceRegistry.InvoiceAlreadyRegistered.selector, first.invoiceIdHash, InvoiceClaimLib.claimHash(first)
            )
        );
        registry.register(conflicting, SUBMITTER);
        vm.stopPrank();
    }

    function test_registerAllowsDistinctInvoiceIds() public {
        vm.startPrank(VERIFIER);
        registry.register(_claim("INV-2026-0001"), SUBMITTER);
        registry.register(_claim("INV-2026-0002"), SUBMITTER);
        vm.stopPrank();
        assertEq(registry.totalVerified(), 2);
    }

    function test_issuerAllowlistBlocksUnknownIssuer() public {
        vm.prank(OWNER);
        registry.setIssuerAllowlistEnabled(true);

        InvoiceClaim memory claim = _claim("INV-2026-0001");
        vm.prank(VERIFIER);
        vm.expectRevert(abi.encodeWithSelector(InvoiceRegistry.IssuerNotAllowed.selector, claim.issuerDomainHash));
        registry.register(claim, SUBMITTER);
    }

    function test_issuerAllowlistPermitsRegisteredIssuer() public {
        InvoiceClaim memory claim = _claim("INV-2026-0001");

        vm.startPrank(OWNER);
        registry.setIssuerAllowlistEnabled(true);
        registry.setIssuerAllowed(claim.issuerDomainHash, true);
        vm.stopPrank();

        vm.prank(VERIFIER);
        registry.register(claim, SUBMITTER);
        assertEq(registry.totalVerified(), 1);
    }

    function test_issuerAllowlistCanBeDisabledAgain() public {
        InvoiceClaim memory claim = _claim("INV-2026-0001");

        vm.startPrank(OWNER);
        registry.setIssuerAllowlistEnabled(true);
        registry.setIssuerAllowlistEnabled(false);
        vm.stopPrank();

        vm.prank(VERIFIER);
        registry.register(claim, SUBMITTER);
        assertEq(registry.totalVerified(), 1);
    }

    function test_unknownClaimIsNotVerified() public view {
        assertFalse(registry.isClaimVerified(keccak256("nope")));
        assertEq(registry.recordOf(keccak256("nope")).verifiedAt, 0);
    }
}
