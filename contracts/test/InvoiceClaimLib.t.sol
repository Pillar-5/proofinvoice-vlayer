// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Test} from "forge-std/Test.sol";

import {InvoiceClaim, InvoiceClaimLib} from "../src/libraries/InvoiceClaim.sol";

/// @dev `vm.expectRevert` only observes *external* calls, so the library's internal
///      functions are exposed through this thin harness to test their failure modes.
contract InvoiceClaimLibHarness {
    function parseAmountMinor(string memory amount) external pure returns (uint256) {
        return InvoiceClaimLib.parseAmountMinor(amount);
    }

    function parseDueDateDays(string memory isoDate) external pure returns (uint64) {
        return InvoiceClaimLib.parseDueDateDays(isoDate);
    }

    function validateInvoiceId(string memory invoiceId) external pure {
        InvoiceClaimLib.validateInvoiceId(invoiceId);
    }

    function validateDomain(string memory domain) external pure {
        InvoiceClaimLib.validateDomain(domain);
    }

    function build(
        string memory invoiceId,
        string memory issuerDomain,
        uint256 amountMinor,
        bytes3 currency,
        uint64 dueDateDays
    ) external pure returns (InvoiceClaim memory) {
        return InvoiceClaimLib.build(invoiceId, issuerDomain, amountMinor, currency, dueDateDays);
    }
}

/// @notice Unit tests for the shared claim schema rules. These functions are used by both
///         the off-chain extractor and the on-chain verifier, so their edge cases are
///         part of the security surface.
contract InvoiceClaimLibTest is Test {
    InvoiceClaimLibHarness private harness = new InvoiceClaimLibHarness();

    function test_currencyAllowlistAcceptsSupportedCodes() public pure {
        assertTrue(InvoiceClaimLib.isSupportedCurrency(bytes3("EUR")));
        assertTrue(InvoiceClaimLib.isSupportedCurrency(bytes3("USD")));
        assertTrue(InvoiceClaimLib.isSupportedCurrency(bytes3("GBP")));
        assertTrue(InvoiceClaimLib.isSupportedCurrency(bytes3("CHF")));
    }

    function test_currencyAllowlistRejectsUnknownCodes() public pure {
        assertFalse(InvoiceClaimLib.isSupportedCurrency(bytes3("XXX")));
        assertFalse(InvoiceClaimLib.isSupportedCurrency(bytes3("BTC")));
        assertFalse(InvoiceClaimLib.isSupportedCurrency(bytes3("eu")));
    }

    function test_caseFolding() public pure {
        assertEq(InvoiceClaimLib.toUpper("inv-2026/0001_a"), "INV-2026/0001_A");
        assertEq(InvoiceClaimLib.toLower("BILLING.Example.COM"), "billing.example.com");
    }

    function test_parseAmountMinorExactValues() public pure {
        assertEq(InvoiceClaimLib.parseAmountMinor("1250.00"), 125_000);
        assertEq(InvoiceClaimLib.parseAmountMinor("0.01"), 1);
        assertEq(InvoiceClaimLib.parseAmountMinor("7.5"), 750);
        assertEq(InvoiceClaimLib.parseAmountMinor("19"), 1_900);
        assertEq(InvoiceClaimLib.parseAmountMinor("1250.9"), 125_090);
    }

    function test_parseAmountMinorRejectsMalformedInput() public {
        string[6] memory invalid = ["", "abc", "1.234", "1.2.3", "-5", "1,"];
        for (uint256 i = 0; i < invalid.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(InvoiceClaimLib.InvalidAmount.selector, invalid[i]));
            harness.parseAmountMinor(invalid[i]);
        }
    }

    function test_parseAmountMinorRejectsZero() public {
        vm.expectRevert(abi.encodeWithSelector(InvoiceClaimLib.InvalidAmount.selector, "0.00"));
        harness.parseAmountMinor("0.00");
    }

    function test_parseDueDateDaysKnownValues() public pure {
        assertEq(InvoiceClaimLib.parseDueDateDays("1970-01-01"), 0);
        assertEq(InvoiceClaimLib.parseDueDateDays("1970-01-02"), 1);
        assertEq(InvoiceClaimLib.parseDueDateDays("2000-03-01"), 11_017);
        assertEq(InvoiceClaimLib.parseDueDateDays("2026-02-14"), 20_498);
        // 2024-02-29 exists (leap year), 2024-03-01 is exactly one day later.
        assertEq(InvoiceClaimLib.parseDueDateDays("2024-03-01") - InvoiceClaimLib.parseDueDateDays("2024-02-29"), 1);
    }

    function test_parseDueDateDaysRejectsMalformedAndInvalidDates() public {
        string[8] memory invalid =
            ["", "2026-2-14", "14-02-2026", "2026/02/14", "2026-13-01", "2026-00-10", "2026-02-30", "2023-02-29"];
        for (uint256 i = 0; i < invalid.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(InvoiceClaimLib.InvalidDueDate.selector, invalid[i]));
            harness.parseDueDateDays(invalid[i]);
        }
    }

    function test_validateInvoiceIdAcceptsAllowedCharset() public pure {
        InvoiceClaimLib.validateInvoiceId("INV-2026/0001_A.7");
        InvoiceClaimLib.validateInvoiceId("abc");
    }

    function test_validateInvoiceIdRejectsBadLengthAndChars() public {
        vm.expectRevert(abi.encodeWithSelector(InvoiceClaimLib.InvalidInvoiceId.selector, "ab"));
        harness.validateInvoiceId("ab");

        vm.expectRevert(abi.encodeWithSelector(InvoiceClaimLib.InvalidInvoiceId.selector, "INV 2026"));
        harness.validateInvoiceId("INV 2026");

        vm.expectRevert(abi.encodeWithSelector(InvoiceClaimLib.InvalidInvoiceId.selector, "INV#1"));
        harness.validateInvoiceId("INV#1");
    }

    function test_validateDomainAcceptsRealDomains() public pure {
        InvoiceClaimLib.validateDomain("billing.example.com");
        InvoiceClaimLib.validateDomain("vlayer.xyz");
    }

    function test_validateDomainRejectsBadInput() public {
        string[5] memory invalid = ["", "com", ".example.com", "example.com.", "billing..example.com"];
        for (uint256 i = 0; i < invalid.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(InvoiceClaimLib.InvalidDomain.selector, invalid[i]));
            harness.validateDomain(invalid[i]);
        }
    }

    /// @dev Two different spellings of the same invoice must collapse to one hash so that
    ///      the registry rejects the duplicate instead of storing it twice.
    function test_buildNormalisesInvoiceIdCase() public pure {
        InvoiceClaim memory a =
            InvoiceClaimLib.build("inv-2026-0001", "billing.example.com", 125_000, bytes3("EUR"), 20_498);
        InvoiceClaim memory b =
            InvoiceClaimLib.build("INV-2026-0001", "billing.example.com", 125_000, bytes3("EUR"), 20_498);
        assertEq(a.invoiceIdHash, b.invoiceIdHash);
        assertEq(InvoiceClaimLib.claimHash(a), InvoiceClaimLib.claimHash(b));
    }

    function test_buildRejectsUnsupportedCurrency() public {
        vm.expectRevert(abi.encodeWithSelector(InvoiceClaimLib.UnsupportedCurrency.selector, bytes3("XXX")));
        harness.build("INV-1", "billing.example.com", 125_000, bytes3("XXX"), 20_498);
    }

    /// @dev Memory structs are reference types in Solidity, so each variant is built
    ///      explicitly instead of mutating a copy.
    function test_claimHashIsFieldSensitive() public pure {
        InvoiceClaim memory base = _claim("INV-2026-0001", "billing.example.com", 125_000, bytes3("EUR"), 20_498);

        assertTrue(
            InvoiceClaimLib.claimHash(base)
                != InvoiceClaimLib.claimHash(
                    _claim("INV-2026-0001", "billing.example.com", 125_001, bytes3("EUR"), 20_498)
                ),
            "amount not covered"
        );
        assertTrue(
            InvoiceClaimLib.claimHash(base)
                != InvoiceClaimLib.claimHash(
                    _claim("INV-2026-0001", "billing.example.com", 125_000, bytes3("USD"), 20_498)
                ),
            "currency not covered"
        );
        assertTrue(
            InvoiceClaimLib.claimHash(base)
                != InvoiceClaimLib.claimHash(
                    _claim("INV-2026-0001", "billing.example.com", 125_000, bytes3("EUR"), 20_499)
                ),
            "dueDate not covered"
        );

        assertTrue(
            InvoiceClaimLib.claimHash(base)
                != InvoiceClaimLib.claimHash(
                    _claim("INV-2026-0002", "billing.example.com", 125_000, bytes3("EUR"), 20_498)
                ),
            "invoice not covered"
        );
        assertTrue(
            InvoiceClaimLib.claimHash(base)
                != InvoiceClaimLib.claimHash(
                    _claim("INV-2026-0001", "attacker.example", 125_000, bytes3("EUR"), 20_498)
                ),
            "domain not covered"
        );
    }

    function _claim(
        string memory invoiceId,
        string memory domain,
        uint256 amountMinor,
        bytes3 currency,
        uint64 dueDateDays
    ) private pure returns (InvoiceClaim memory) {
        return InvoiceClaimLib.build(invoiceId, domain, amountMinor, currency, dueDateDays);
    }
}
